using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace BlackThunder.BlackPy
{
    /// <summary>Serializes the simulation, command completion, and process lifecycle on one owner thread.</summary>
    public class RuntimeSession : IAsyncDisposable
    {
        // Internal
        private readonly string _projectDirectory;
        private readonly PythonCommand _python;
        private readonly string _baseUrl;
        private readonly string _token;
        private readonly Channel<Action> _actions = Channel.CreateBounded<Action>(256);
        private readonly Dictionary<Guid, BrowserConnection> _browsers = new();
        private readonly Queue<OutputLine> _output = new();
        private readonly Queue<CommandTicket> _commands = new();
        private readonly SceneController _scene = new();
        private readonly List<TaskCompletionSource<StateMessage>> _stopWaiters = new();
        private readonly TaskCompletionSource<bool> _closed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly Thread _thread;
        private MotionController _motion = null!;
        private ProcessRun? _process;
        private CommandTicket? _currentCommand;
        private Task? _currentMotion;
        private TaskCompletionSource<StateMessage>? _restartWaiter;
        private string? _runId;
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
        public RuntimeSession(string projectDirectory, PythonCommand python, string baseUrl, string token)
        {
            _projectDirectory = projectDirectory;
            _python = python;
            _baseUrl = baseUrl;
            _token = token;
            _thread = new Thread(RunLoop) { IsBackground = true, Name = "Elementary simulation" };
            _thread.Start();
        }

        public Task<StateMessage> GetStateAsync() => DispatchAsync(Snapshot);
        public Task<StateMessage> RunAsync() => DispatchAsync(StartRun);
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

        public async Task<StateMessage> CommandAsync(CommandRequest request)
        {
            return await await DispatchAsync(() =>
            {
                if (_status != "running" || _process == null || request.RunId != _runId)
                    throw new BlackPyException(409, "끝났거나 다른 실행의 명령입니다.");
                if (_commands.Count >= 128) throw new BlackPyException(429, "대기 중인 이동 명령이 너무 많습니다.");

                MotionController.Validate(request.Command, request.Args);
                var ticket = new CommandTicket(request.Command, request.Args);
                _commands.Enqueue(ticket);
                return ticket.Completion.Task;
            });
        }

        public Task<BrowserConnection> ConnectAsync() => DispatchAsync(() =>
        {
            if (_shuttingDown) throw new BlackPyException(503, "실행 프로그램이 종료됩니다.");
            var connection = new BrowserConnection();
            _browsers.Add(connection.Id, connection);
            connection.Messages.Writer.TryWrite(Snapshot());
            return connection;
        });

        public Task DisconnectAsync(BrowserConnection connection) => DispatchAsync(() =>
        {
            _browsers.Remove(connection.Id);
            connection.Messages.Writer.TryComplete();

            if (_browsers.Count == 0)
            {
                _restartWaiter?.TrySetException(new BlackPyException(409, "웹 화면의 연결이 끊겼습니다."));
                _restartWaiter = null;
                BeginStop();
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

        // Simulation
        private void RunLoop()
        {
            try
            {
                using var motion = new MotionController();
                using var changes = motion.Subscribe(_ => _dirty = true);
                _motion = motion;
                var clock = Stopwatch.StartNew();
                var previous = clock.Elapsed.TotalSeconds;
                var lastPublication = previous;

                while (true)
                {
                    for (int i = 0; i < 128 && _actions.Reader.TryRead(out var action); i++) action();
                    if (_shuttingDown && _process == null) break;

                    var now = clock.Elapsed.TotalSeconds;
                    var deltaTime = (float)(now - previous);
                    previous = now;
                    _motion.Tick(deltaTime);
                    AdvanceCommands();

                    if (_dirty && now - lastPublication >= 1.0 / 30)
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

        private void AdvanceCommands()
        {
            if (_currentCommand != null && _currentMotion!.IsCompleted)
            {
                if (_currentMotion.IsCompletedSuccessfully) _currentCommand.Completion.TrySetResult(Snapshot());
                else _currentCommand.Completion.TrySetException(new BlackPyException(409, "이동이 중지되었습니다."));
                _currentCommand = null;
                _currentMotion = null;
            }

            if (_currentCommand != null || _commands.Count == 0 || _status != "running") return;

            var next = _commands.Dequeue();

            try
            {
                _currentMotion = _motion.Command(next.Command, next.Args);
                _currentCommand = next;
            }
            catch (Exception exception)
            {
                next.Completion.TrySetException(exception);
            }
        }

        private void CancelCommands()
        {
            _motion.Cancel();
            var exception = new BlackPyException(409, "이동이 중지되었습니다.");
            _currentCommand?.Completion.TrySetException(exception);
            _currentCommand = null;
            _currentMotion = null;

            while (_commands.TryDequeue(out var command)) command.Completion.TrySetException(exception);
        }

        // Python lifetime
        private StateMessage StartRun()
        {
            if (_shuttingDown) throw new BlackPyException(503, "실행 프로그램을 종료하는 중입니다.");
            if (_process != null) throw new BlackPyException(409, "이미 실행 중입니다. 중지하거나 다시 시작해 주세요.");
            if (_browsers.Count == 0) throw new BlackPyException(409, "웹 화면을 먼저 열어 주세요.");
            if (!File.Exists(Path.Combine(_projectDirectory, "main.py")))
                throw new BlackPyException(400, "시작.bat 옆에 main.py를 저장해 주세요.");

            _motion.Reset();
            _output.Clear();
            _outputRevision++;
            _outputDirty = true;
            _lastErrorLine = null;
            _error = null;
            _runId = Guid.NewGuid().ToString("N");
            _scene.BeginRun(_runId);
            _status = "running";
            _stopping = false;
            _dirty = true;

            var info = _python.CreateStartInfo();
            info.ArgumentList.Add("-u");
            info.ArgumentList.Add("-c");
            // Student code starts only after Windows has attached the process to its Job Object.
            info.ArgumentList.Add("import sys, runpy; gate = sys.stdin.buffer.read(1); " +
                "sys.exit(1) if gate != b'G' else None; sys.argv = ['main.py']; " +
                "runpy.run_path('main.py', run_name='__main__')");
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
                process.StandardInput.Close();
                return Snapshot();
            }
            catch (Exception exception)
            {
                _scene.EndRun();
                _status = "error";
                _error = "Python 실행 실패: " + exception.Message;
                throw new BlackPyException(500, _error);
            }
        }

        private Task<StateMessage> BeginStop()
        {
            CancelCommands();
            _scene.EndRun();

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

            CancelCommands();
            _process = null;
            _scene.EndRun();
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
                X = _motion.Transform.Position.X,
                Y = _motion.Transform.Position.Y,
                Heading = _motion.Heading,
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

        private class CommandTicket
        {
            public string Command { get; }
            public double[] Args { get; }
            public TaskCompletionSource<StateMessage> Completion { get; } = RuntimeSession.Completion<StateMessage>();
            public CommandTicket(string command, double[] args) { Command = command; Args = args; }
        }

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
