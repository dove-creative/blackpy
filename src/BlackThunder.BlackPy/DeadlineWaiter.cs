using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace BlackThunder.BlackPy
{
    /// <summary>Waits for a deadline or request without changing system timer resolution.</summary>
    public class DeadlineWaiter : IDisposable
    {
        // Internal
        private readonly object _gate = new();
        private readonly AutoResetEvent _signal = new(false);
        private readonly WaitHandle? _timer;
        private readonly WaitHandle[]? _handles;
        private bool _disposed;


        // Content
        public DeadlineWaiter()
        {
            if (!OperatingSystem.IsWindows()) return;

            const uint HighResolution = 0x00000002;
            const uint TimerAccess = 0x00100002; // SYNCHRONIZE | TIMER_MODIFY_STATE
            var timer = CreateWaitableTimerExW(IntPtr.Zero, null, HighResolution, TimerAccess);

            try
            {
                if (timer.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                _timer = new TimerHandle(timer);
                _handles = new WaitHandle[] { _signal, _timer };
            }
            catch
            {
                timer.Dispose();
                _signal.Dispose();
                throw;
            }
        }

        public void Signal()
        {
            lock (_gate)
            {
                // A queued request may finish its enqueue after the owner has closed the session.
                if (!_disposed) _signal.Set();
            }
        }

        /// <summary>Owner-only wait: null waits for a request, and an elapsed deadline returns immediately.</summary>
        public void Wait(TimeSpan? remaining)
        {
            lock (_gate)
            {
                if (_disposed) throw new ObjectDisposedException(nameof(DeadlineWaiter));
            }

            if (!remaining.HasValue)
            {
                _signal.WaitOne();
                return;
            }

            if (remaining.Value <= TimeSpan.Zero) return;

            if (_timer == null)
            {
                var timeout = (int)Math.Clamp(Math.Ceiling(remaining.Value.TotalMilliseconds), 1, int.MaxValue);
                _signal.WaitOne(timeout);
                return;
            }

            // TimeSpan ticks already use the native timer's 100 ns unit; negative values are relative.
            var dueTime = -remaining.Value.Ticks;
            if (!SetWaitableTimerEx(_timer.SafeWaitHandle, ref dueTime, 0,
                    IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error());

            try { WaitHandle.WaitAny(_handles!); }
            finally { CancelWaitableTimer(_timer.SafeWaitHandle); }
        }

        /// <summary>Called by the owner after its final Wait; concurrent Signal calls remain safe.</summary>
        public void Dispose()
        {
            lock (_gate)
            {
                if (_disposed) return;
                _disposed = true;
                _timer?.Dispose();
                _signal.Dispose();
            }
        }

        private class TimerHandle : WaitHandle
        {
            public TimerHandle(SafeWaitHandle handle) => SafeWaitHandle = handle;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern SafeWaitHandle CreateWaitableTimerExW(
            IntPtr attributes, string? name, uint flags, uint desiredAccess);

        [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetWaitableTimerEx(
            SafeWaitHandle timer, ref long dueTime, int period, IntPtr completionRoutine,
            IntPtr completionArgument, IntPtr wakeContext, uint tolerableDelay);

        [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CancelWaitableTimer(SafeWaitHandle timer);
    }
}
