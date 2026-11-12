using System;

namespace BlackThunder.BlackPy
{
    /// <summary>Allows a browser to reconnect before requesting host shutdown.</summary>
    public class BrowserLifetime
    {
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
            if (_stopRequested) return false;
            var firstConnectionExpired = !_hasConnected && _firstConnectionTimeout.HasValue
                && now >= _firstConnectionTimeout.Value;
            var disconnectedExpired = _disconnectedAt.HasValue && now - _disconnectedAt.Value >= _grace;
            if (!firstConnectionExpired && !disconnectedExpired) return false;
            _stopRequested = true;
            return true;
        }
    }
}
