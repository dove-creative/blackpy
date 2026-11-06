using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace BlackThunder.BlackPy
{
    /// <summary>Keeps a Python run and its descendants in one Windows lifetime boundary.</summary>
    internal class ProcessTree : IDisposable
    {
        private readonly Process _process;
        private readonly SafeFileHandle? _job;

        public ProcessTree(Process process)
        {
            _process = process;
            if (!OperatingSystem.IsWindows()) return;

            var job = CreateJobObject(IntPtr.Zero, null);

            try
            {
                if (job.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                var information = new ExtendedLimitInformation();
                information.BasicLimitInformation.LimitFlags = 0x00002000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

                if (!SetInformationJobObject(job, 9, ref information, Marshal.SizeOf<ExtendedLimitInformation>()))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                if (!AssignProcessToJobObject(job, process.Handle))
                    throw new Win32Exception(Marshal.GetLastWin32Error());

                _job = job;
            }
            catch
            {
                job.Dispose();
                throw;
            }
        }

        public void Terminate()
        {
            try
            {
                if (_job != null && !_job.IsClosed && TerminateJobObject(_job, 1)) return;
                if (!_process.HasExited) _process.Kill(true);
            }
            catch (InvalidOperationException) { }
            catch (Win32Exception) { }
        }

        public void Dispose() => _job?.Dispose();

        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimitInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ExtendedLimitInformation
        {
            public BasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateJobObject(IntPtr attributes, string? name);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(
            SafeFileHandle job, int informationClass, ref ExtendedLimitInformation information, int length);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateJobObject(SafeFileHandle job, uint exitCode);
    }
}
