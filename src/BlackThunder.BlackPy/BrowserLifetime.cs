using System;

namespace BlackThunder.BlackPy
{
    /// <summary>Allows a browser to reconnect before requesting host shutdown.</summary>
    public class BrowserLifetime
    {
        // Property
        public TimeSpan? Deadline => _stopRequested ? null
            : !_hasConnected ? _firstConnectionTimeout : _disconnectedAt + _grace;

        // Internal
        private readonly TimeSpan _grace;
        private readonly TimeSpan? _firstConnectionTimeout;
        private TimeSpan? _disconnectedAt;
        private bool _hasConnected;
        private bool _stopRequested;


        // Content
        public BrowserLifetime(TimeSpan grace, TimeSpan? firstConnectionTimeout = null)
        {
            if (grace < TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(grace));
            if (firstConnectionTimeout.HasValue && firstConnectionTimeout.Value < TimeSpan.Zero)
                throw new ArgumentOutOfRangeException(nameof(firstConnectionTimeout));
            _grace = grace;
            _firstConnectionTimeout = firstConnectionTimeout;
        }

        public void Connected()
        {
            _hasConnected = true;
            _disconnectedAt = null;
        }

        public void Disconnected(TimeSpan now)
        {
            if (!_hasConnected || _stopRequested) return;
            _disconnectedAt = now;
        }

        public bool ShouldStop(TimeSpan now)
        {
            if (Deadline is not TimeSpan deadline || now < deadline) return false;
            _stopRequested = true;
            return true;
        }
    }
}
