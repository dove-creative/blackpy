using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace BlackThunder.BlackPy
{
    /// <summary>Serializes project snapshots, input, scenes, and process lifecycle on one owner thread.</summary>
    public class RuntimeSession : IAsyncDisposable
    {
        // Internal
        private readonly string _projectDirectory;
        private readonly PythonCommand _python;
        private readonly string _baseUrl;
        private readonly string _token;
        private readonly Action? _stopApplication;
        private readonly BrowserLifetime _browserLifetime;
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private readonly Channel<Action> _actions = Channel.CreateBounded<Action>(256);
        private readonly Dictionary<Guid, BrowserConnection> _browsers = new();
        private readonly Queue<OutputLine> _output = new();
        private readonly SceneController _scene = new();
        private readonly InputController _input = new();
        private readonly List<TaskCompletionSource<StateMessage>> _stopWaiters = new();
        private readonly TaskCompletionSource<bool> _closed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly Thread _thread;
        private ProcessRun? _process;
        private TaskCompletionSource<StateMessage>? _restartWaiter;
        private string? _runId;
        private ProjectSnapshot? _source;
        private string _status = "ready";
        private string? _error;
        private string? _lastErrorLine;
        private bool _stopping;
        private bool _shuttingDown;
        private bool _dirty = true;
        private bool _outputDirty;
        private long _outputRevision;
        private OutputLine[] _outputSnapshot = Array.Empty<OutputLine>();


        // Content --------------------
        // Construction and requests
        public RuntimeSession(
            string projectDirectory,
            PythonCommand python,
            string baseUrl,
            string token,
            Action? stopApplication = null,
            TimeSpan? firstBrowserTimeout = null)
        {
            _projectDirectory = projectDirectory;
            _python = python;
            _baseUrl = baseUrl;
            _token = token;
            _stopApplication = stopApplication;
            _browserLifetime = new BrowserLifetime(TimeSpan.FromSeconds(3), firstBrowserTimeout);
            _thread = new Thread(RunLoop) { IsBackground = true, Name = "BlackPy session" };
            _thread.Start();
        }

        public Task<StateMessage> GetStateAsync() => DispatchAsync(Snapshot);
        public Task<StateMessage> RunAsync() => DispatchAsync(StartRun);
        public Task<ProjectDefinition> GetProjectAsync() => DispatchAsync(() =>
            _source?.Project ?? ProjectLoader.ReadDefinition(_projectDirectory));
        public Task<ProjectSnapshot> GetSourceAsync(string runId) => DispatchAsync(() =>
        {
            RequireActiveRun(runId);
            return _source!;
        });

        public Task<InputEvent[]> GetEventsAsync(string runId) => DispatchAsync(() =>
        {
            RequireActiveRun(runId);
            return _input.Drain(runId);
        });

        public Task<StateMessage> InputAsync(InputRequest request) => DispatchAsync(() =>
        {
            RequireActiveRun(request.RunId);
            _input.Submit(request);
            return Snapshot();
        });

        public Task<StateMessage> FrameAsync(SceneFrameRequest request) => DispatchAsync(() =>
        {
            if (_status != "running" || _process == null)
                throw new BlackPyException(409, "끝났거나 다른 실행의 장면입니다.");

            _scene.Submit(request);
            _dirty = true;
            return Snapshot();
        });

        public async Task<StateMessage> StopAsync() => await await DispatchAsync(() =>
        {
            _restartWaiter?.TrySetException(new BlackPyException(409, "다시 시작이 취소되었습니다."));
            _restartWaiter = null;
            return BeginStop();
        });

        public async Task<StateMessage> RestartAsync()
        {
            return await await DispatchAsync(() =>
            {
                if (_restartWaiter != null) throw new BlackPyException(409, "다시 시작하는 중입니다.");
                if (_browsers.Count == 0) throw new BlackPyException(409, "웹 화면을 먼저 열어 주세요.");
                if (_process == null) return Task.FromResult(StartRun());

                _restartWaiter = Completion<StateMessage>();
                var task = _restartWaiter.Task;
                BeginStop();
                return task;
            });
        }

        public Task<BrowserConnection> ConnectAsync() => DispatchAsync(() =>
        {
            if (_shuttingDown) throw new BlackPyException(503, "실행 프로그램이 종료됩니다.");
            var connection = new BrowserConnection();
            _browsers.Add(connection.Id, connection);
            _browserLifetime.Connected();
            connection.Messages.Writer.TryWrite(Snapshot());
            return connection;
        });

        public Task DisconnectAsync(BrowserConnection connection) => DispatchAsync(() =>
        {
            if (!_browsers.Remove(connection.Id)) return false;
            connection.Messages.Writer.TryComplete();

            if (_browsers.Count == 0)
            {
                _restartWaiter?.TrySetException(new BlackPyException(409, "웹 화면의 연결이 끊겼습니다."));
                _restartWaiter = null;
                BeginStop();
                _browserLifetime.Disconnected(_clock.Elapsed);
            }
            else if (_status == "running" && _runId != null)
            {
                // A vanished browser cannot send the releases for its held keys.
                _input.Submit(new InputRequest { RunId = _runId, Kind = "reset" });
            }

            return true;
        });

        private async Task<T> DispatchAsync<T>(Func<T> operation)
        {
            if (_closed.Task.IsCompleted) throw new BlackPyException(503, "실행 프로그램이 종료되었습니다.");
            var completion = Completion<T>();

            try
            {
                await _actions.Writer.WriteAsync(() =>
                {
                    try { completion.TrySetResult(operation()); }
                    catch (Exception exception) { completion.TrySetException(exception); }
                });
            }
            catch (ChannelClosedException)
            {
                throw new BlackPyException(503, "실행 프로그램이 종료되었습니다.");
            }

            return await completion.Task;
        }

        // Session loop
        private void RunLoop()
        {
            try
            {
                var lastPublication = _clock.Elapsed.TotalSeconds;

                while (true)
                {
                    for (int i = 0; i < 128 && _actions.Reader.TryRead(out var action); i++) action();
                    if (_shuttingDown && _process == null) break;

                    if (!_shuttingDown && _browserLifetime.ShouldStop(_clock.Elapsed)) _stopApplication?.Invoke();

                    var now = _clock.Elapsed.TotalSeconds;
                    if (_dirty && now - lastPublication >= 1.0 / 60)
                    {
                        Publish();
                        lastPublication = now;
                    }

                    Thread.Sleep(5);
                }

                Publish();
                foreach (var browser in _browsers.Values) browser.Messages.Writer.TryComplete();
                _actions.Writer.TryComplete();
                while (_actions.Reader.TryRead(out var remaining)) remaining();
                _closed.TrySetResult(true);
            }
            catch (Exception exception)
            {
                _process?.Tree.Terminate();
                _actions.Writer.TryComplete(exception);
                _closed.TrySetException(exception);
            }
        }

        // Python lifetime
        private StateMessage StartRun()
        {
            if (_shuttingDown) throw new BlackPyException(503, "실행 프로그램을 종료하는 중입니다.");
            if (_process != null) throw new BlackPyException(409, "이미 실행 중입니다. 중지하거나 다시 시작해 주세요.");
            if (_browsers.Count == 0) throw new BlackPyException(409, "웹 화면을 먼저 열어 주세요.");
            var runner = Path.Combine(AppContext.BaseDirectory, "_blackpy_runner.py");
            if (!File.Exists(runner))
                throw new BlackPyException(500, "Python 실행 지원 파일이 없습니다. 실행 프로그램을 다시 배포해 주세요.");
            // Preserve every configured source and its exact encoding for this run.
            var source = ProjectLoader.ReadSnapshot(_projectDirectory);

            _output.Clear();
            _outputRevision++;
            _outputDirty = true;
            _lastErrorLine = null;
            _error = null;
            _runId = Guid.NewGuid().ToString("N");
            _source = source;
            _scene.BeginRun(_runId);
            _input.BeginRun(_runId);
            _status = "running";
            _stopping = false;
            _dirty = true;

            var info = _python.CreateStartInfo();
            info.ArgumentList.Add("-u");
            info.ArgumentList.Add("-c");
            // Student code starts only after Windows has attached the process to its Job Object.
            info.ArgumentList.Add("import sys, runpy; gate = sys.stdin.buffer.read(1); " +
                "sys.exit(1) if gate != b'G' else None; " +
                "runpy.run_path(sys.argv[1], run_name='__main__')");
            info.ArgumentList.Add(runner);
            info.WorkingDirectory = _projectDirectory;
            info.Environment["PLAYGROUND_URL"] = _baseUrl;
            info.Environment["PLAYGROUND_TOKEN"] = _token;
            info.Environment["PLAYGROUND_RUN_ID"] = _runId;

            try
            {
                var process = Process.Start(info) ?? throw new InvalidOperationException("Python을 실행하지 못했습니다.");
                ProcessRun run;

                try { run = new ProcessRun(_runId, process); }
                catch
                {
                    TryKill(process);
                    process.Dispose();
                    throw;
                }

                _process = run;
                _ = MonitorProcessAsync(run);
                process.StandardInput.Write("G");
                process.StandardInput.WriteLine(JsonSerializer.Serialize(source, StateMessage.JsonOptions));
                process.StandardInput.Close();
                return Snapshot();
            }
            catch (Exception exception)
            {
                _scene.EndRun();
                _input.EndRun();
                _source = null;
                _status = "error";
                _error = "Python 실행 실패: " + exception.Message;
                throw new BlackPyException(500, _error);
            }
        }

        private Task<StateMessage> BeginStop()
        {
            _scene.EndRun();
            _input.EndRun();
            _source = null;

            if (_process == null) return Task.FromResult(Snapshot());

            _stopping = true;
            _status = "stopped";
            _dirty = true;
            var waiter = Completion<StateMessage>();
            _stopWaiters.Add(waiter);
            var run = _process;
            _ = Task.Run(run.Tree.Terminate);
            return waiter.Task;
        }

        private async Task MonitorProcessAsync(ProcessRun run)
        {
            var stdout = ReadOutputAsync(run, run.Process.StandardOutput, "stdout");
            var stderr = ReadOutputAsync(run, run.Process.StandardError, "stderr");
            var exitCode = -1;

            try
            {
                await run.Process.WaitForExitAsync();
                // A completed parent must not leave descendants holding redirected pipes open.
                run.Tree.Terminate();
                await Task.WhenAll(stdout, stderr);
                exitCode = run.Process.ExitCode;
            }
            catch (Exception exception)
            {
                await AppendOutputAsync(run.Id, "stderr", exception.Message);
                run.Tree.Terminate();
            }

            try { await DispatchAsync(() => { FinishRun(run, exitCode); return true; }); }
            catch (BlackPyException) { run.Dispose(); }
        }

        private async Task ReadOutputAsync(ProcessRun run, StreamReader reader, string stream)
        {
            var buffer = new char[1024];
            var line = new StringBuilder();
            var previousWasCarriageReturn = false;
            int length;

            while ((length = await reader.ReadAsync(buffer, 0, buffer.Length)) > 0)
            {
                var lines = new List<string>();

                for (int i = 0; i < length; i++)
                {
                    var character = buffer[i];

                    if (character == '\n' && previousWasCarriageReturn)
                    {
                        previousWasCarriageReturn = false;
                        continue;
                    }

                    previousWasCarriageReturn = character == '\r';

                    if (character == '\r' || character == '\n')
                    {
                        lines.Add(line.ToString());
                        line.Clear();
                    }
                    else
                    {
                        line.Append(character);

                        if (line.Length >= 2048)
                        {
                            lines.Add(line.ToString());
                            line.Clear();
                        }
                    }
                }

                if (lines.Count > 0) await AppendOutputAsync(run.Id, stream, lines);
            }

            if (line.Length > 0) await AppendOutputAsync(run.Id, stream, line.ToString());
        }

        private Task AppendOutputAsync(string runId, string stream, string text) =>
            AppendOutputAsync(runId, stream, new[] { text });

        private Task AppendOutputAsync(string runId, string stream, IEnumerable<string> lines) => DispatchAsync(() =>
        {
            if (_runId != runId) return false;

            foreach (var text in lines)
            {
                _output.Enqueue(new OutputLine(stream, text));
                while (_output.Count > 1000) _output.Dequeue();
                if (stream == "stderr" && !string.IsNullOrWhiteSpace(text)) _lastErrorLine = text;
            }
            _outputDirty = true;
            _outputRevision++;
            _dirty = true;
            return true;
        });

        private void FinishRun(ProcessRun run, int exitCode)
        {
            if (_process != run) { run.Dispose(); return; }

            _process = null;
            _scene.EndRun();
            _input.EndRun();
            _source = null;
            run.Dispose();

            if (!_stopping)
            {
                _status = exitCode == 0 ? "completed" : "error";
                if (exitCode != 0) _error = _lastErrorLine ?? "Python 코드 실행 중 오류가 발생했습니다.";
            }

            _stopping = false;
            _dirty = true;
            var stopped = Snapshot();
            foreach (var waiter in _stopWaiters) waiter.TrySetResult(stopped);
            _stopWaiters.Clear();

            var restart = _restartWaiter;
            _restartWaiter = null;

            if (restart != null)
            {
                try { restart.TrySetResult(StartRun()); }
                catch (Exception exception) { restart.TrySetException(exception); }
            }
        }

        // Snapshots and shutdown
        private void RequireActiveRun(string runId)
        {
            if (_status != "running" || _process == null || runId != _runId)
                throw new BlackPyException(409, "끝났거나 다른 실행의 요청입니다.");
        }

        private StateMessage Snapshot()
        {
            if (_outputDirty)
            {
                _outputSnapshot = _output.ToArray();
                _outputDirty = false;
            }

            return new StateMessage
            {
                Status = _status,
                RunId = _runId,
                Scene = _scene.State,
                Error = _error,
                Output = _outputSnapshot,
                OutputRevision = _outputRevision
            };
        }

        private void Publish()
        {
            var snapshot = Snapshot();
            foreach (var browser in _browsers.Values) browser.Messages.Writer.TryWrite(snapshot);
            _dirty = false;
        }

        public async Task ShutdownAsync()
        {
            if (_closed.Task.IsCompleted) { await _closed.Task; return; }

            try
            {
                await DispatchAsync(() =>
                {
                    _shuttingDown = true;
                    _restartWaiter?.TrySetException(new BlackPyException(503, "실행 프로그램이 종료됩니다."));
                    _restartWaiter = null;
                    BeginStop();
                    return true;
                });
            }
            catch (BlackPyException) { }

            await _closed.Task;
        }

        public async ValueTask DisposeAsync() => await ShutdownAsync();

        private static void TryKill(Process? process)
        {
            if (process == null) return;

            try { if (!process.HasExited) process.Kill(true); }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
        }

        private static TaskCompletionSource<T> Completion<T>() =>
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        private class ProcessRun : IDisposable
        {
            public string Id { get; }
            public Process Process { get; }
            public ProcessTree Tree { get; }

            public ProcessRun(string id, Process process)
            {
                Id = id;
                Process = process;
                Tree = new ProcessTree(process);
            }

            public void Dispose()
            {
                Tree.Dispose();
                Process.Dispose();
            }
        }
    }
}
