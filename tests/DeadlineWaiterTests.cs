using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using BlackThunder.BlackPy;
using NUnit.Framework;

namespace BlackThunder.BlackPy.Tests
{
    [TestFixture]
    public class DeadlineWaiterTests
    {
        [Test]
        public async Task RequestWakesAnIndefiniteWait()
        {
            using var waiter = new DeadlineWaiter();
            using var started = new ManualResetEventSlim();
            var waiting = Task.Run(() =>
            {
                started.Set();
                waiter.Wait(null);
            });
            Assert.That(started.Wait(TimeSpan.FromSeconds(2)), Is.True);
            Assert.That(waiting.IsCompleted, Is.False);
            waiter.Signal();
            await waiting.WaitAsync(TimeSpan.FromSeconds(2));
        }

        [Test]
        public async Task PendingRequestPreemptsADeadlineAndDoesNotPersist()
        {
            using var waiter = new DeadlineWaiter();
            waiter.Signal();
            await Task.Run(() => waiter.Wait(TimeSpan.FromSeconds(10))).WaitAsync(TimeSpan.FromSeconds(2));

            var clock = Stopwatch.StartNew();
            waiter.Wait(TimeSpan.FromMilliseconds(20));
            Assert.That(clock.Elapsed.TotalMilliseconds, Is.GreaterThanOrEqualTo(10));
        }

        [Test]
        public void CompletedTimerCanBeRearmedWithoutAnImmediateStaleWake()
        {
            using var waiter = new DeadlineWaiter();
            waiter.Wait(TimeSpan.FromMilliseconds(1));
            var clock = Stopwatch.StartNew();
            waiter.Wait(TimeSpan.FromMilliseconds(20));
            Assert.That(clock.Elapsed.TotalMilliseconds, Is.GreaterThanOrEqualTo(10));
        }

        [Test]
        public async Task DisposalAndLateRequestSignalsDoNotRaceOnAClosedHandle()
        {
            var waiter = new DeadlineWaiter();
            var signaling = Task.Run(() =>
            {
                for (int i = 0; i < 1000; i++) waiter.Signal();
            });
            waiter.Dispose();
            await signaling;
            Assert.DoesNotThrow(waiter.Signal);
            Assert.DoesNotThrow(waiter.Dispose);
            Assert.Throws<ObjectDisposedException>(() => waiter.Wait(TimeSpan.Zero));
        }

        [Test]
        public void ElapsedDeadlineDoesNotConsumeAPendingRequest()
        {
            using var waiter = new DeadlineWaiter();
            waiter.Signal();
            waiter.Wait(TimeSpan.Zero);
            waiter.Wait(TimeSpan.FromTicks(-1));
            waiter.Wait(null);
        }
    }
}
