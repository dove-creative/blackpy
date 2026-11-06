using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace BlackThunder.BlackPy
{
    public class PythonCommand
    {
        public string Executable { get; }
        public string[] PrefixArguments { get; }

        public PythonCommand(string executable, params string[] prefixArguments)
        {
            Executable = executable;
            PrefixArguments = prefixArguments;
        }

        public ProcessStartInfo CreateStartInfo()
        {
            var info = new ProcessStartInfo(Executable)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };

            info.Environment["PYTHONUTF8"] = "1";
            info.Environment["PYTHONIOENCODING"] = "utf-8";
            foreach (var argument in PrefixArguments) info.ArgumentList.Add(argument);
            return info;
        }

        public static async Task<PythonCommand> ResolveAsync()
        {
            var specified = Environment.GetEnvironmentVariable("PYTHON_EXE");
            var candidates = new List<PythonCommand>();

            if (!string.IsNullOrWhiteSpace(specified)) candidates.Add(new PythonCommand(specified));
            candidates.Add(new PythonCommand("python"));
            candidates.Add(new PythonCommand("py", "-3"));

            foreach (var candidate in candidates)
            {
                var executable = await candidate.FindExecutableAsync();
                if (executable != null) return new PythonCommand(executable);
            }

            throw new InvalidOperationException("Python 3.10 이상을 찾지 못했습니다. " +
                "Python 설치 경로를 PATH 또는 PYTHON_EXE에 지정해 주세요.");
        }

        private async Task<string?> FindExecutableAsync()
        {
            var info = CreateStartInfo();
            info.ArgumentList.Add("-c");
            info.ArgumentList.Add("import sys; print('ELEMENTARY_PYTHON_OK:' + sys.executable " +
                "if sys.version_info >= (3, 10) else 'OLD')");

            try
            {
                using var process = Process.Start(info);
                if (process == null) return null;
                process.StandardInput.Close();
                var output = process.StandardOutput.ReadToEndAsync();
                var errors = process.StandardError.ReadToEndAsync();
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));

                try
                {
                    await process.WaitForExitAsync(timeout.Token);
                }
                catch (OperationCanceledException)
                {
                    process.Kill(true);
                    await process.WaitForExitAsync();
                    await Task.WhenAll(output, errors);
                    return null;
                }

                await errors;
                var result = (await output).Trim();
                const string marker = "ELEMENTARY_PYTHON_OK:";
                if (process.ExitCode != 0 || !result.StartsWith(marker, StringComparison.Ordinal)) return null;

                var executable = result.Substring(marker.Length);
                return File.Exists(executable) ? executable : null;
            }
            catch (Exception error) when (error is System.ComponentModel.Win32Exception || error is IOException)
            {
                return null;
            }
        }
    }
}
