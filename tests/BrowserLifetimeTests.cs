using System;
using BlackThunder.BlackPy;
using NUnit.Framework;

namespace BlackThunder.BlackPy.Tests
{
    [TestFixture]
    public class BrowserLifetimeTests
    {
        [Test]
        public void UnconnectedHostDoesNotStartTheShutdownClock()
        {
            var lifetime = new BrowserLifetime(TimeSpan.FromSeconds(3));
            lifetime.Disconnected(TimeSpan.Zero);
            Assert.That(lifetime.ShouldStop(TimeSpan.FromDays(1)), Is.False);
        }

        [Test]
        public void LastDisconnectionRequestsShutdownOnceAfterTheGrace()
        {
            var lifetime = new BrowserLifetime(TimeSpan.FromSeconds(3));
            lifetime.Connected();
            lifetime.Disconnected(TimeSpan.FromSeconds(10));
            Assert.That(lifetime.ShouldStop(TimeSpan.FromSeconds(12.999)), Is.False);
            Assert.That(lifetime.ShouldStop(TimeSpan.FromSeconds(13)), Is.True);
            Assert.That(lifetime.ShouldStop(TimeSpan.FromSeconds(14)), Is.False);
        }

        [Test]
        public void ReconnectionCancelsTheOldDeadlineAndNextDisconnectionStartsANewOne()
        {
            var lifetime = new BrowserLifetime(TimeSpan.FromSeconds(3));
            lifetime.Connected();
            lifetime.Disconnected(TimeSpan.FromSeconds(10));
            lifetime.Connected();
            Assert.That(lifetime.ShouldStop(TimeSpan.FromSeconds(20)), Is.False);
            lifetime.Disconnected(TimeSpan.FromSeconds(20));
            Assert.That(lifetime.ShouldStop(TimeSpan.FromSeconds(22)), Is.False);
            Assert.That(lifetime.ShouldStop(TimeSpan.FromSeconds(23)), Is.True);
        }

        [Test]
        public void ConnectedBrowserDoesNotExpire()
        {
            var lifetime = new BrowserLifetime(TimeSpan.FromSeconds(3));
            lifetime.Connected();
            Assert.That(lifetime.ShouldStop(TimeSpan.FromDays(1)), Is.False);
        }

        [Test]
        public void AutomaticBrowserStartupTimesOutAtTheFirstConnectionDeadline()
        {
            var lifetime = new BrowserLifetime(TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(60));
            Assert.That(lifetime.ShouldStop(TimeSpan.FromSeconds(59.999)), Is.False);
            Assert.That(lifetime.ShouldStop(TimeSpan.FromSeconds(60)), Is.True);
            Assert.That(lifetime.ShouldStop(TimeSpan.FromSeconds(61)), Is.False);
        }

        [Test]
        public void FirstConnectionCancelsStartupTimeoutAndUsesDisconnectionGraceAfterward()
        {
            var lifetime = new BrowserLifetime(TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(60));
            lifetime.Connected();
            Assert.That(lifetime.ShouldStop(TimeSpan.FromSeconds(70)), Is.False);
            lifetime.Disconnected(TimeSpan.FromSeconds(70));
            Assert.That(lifetime.ShouldStop(TimeSpan.FromSeconds(72)), Is.False);
            Assert.That(lifetime.ShouldStop(TimeSpan.FromSeconds(73)), Is.True);
        }

        [Test]
        public void NegativeGraceIsRejected() =>
            Assert.Throws<ArgumentOutOfRangeException>(() => new BrowserLifetime(TimeSpan.FromSeconds(-1)));
    }
}
