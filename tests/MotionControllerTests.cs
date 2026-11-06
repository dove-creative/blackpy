using System;
using BlackThunder.BlackPy;
using NUnit.Framework;

namespace BlackThunder.BlackPy.Tests
{
    [TestFixture]
    public class MotionControllerTests
    {
        [TestCase("forward", 100, 100)]
        [TestCase("backward", 100, -100)]
        [TestCase("forward", -100, -100)]
        [TestCase("backward", -100, 100)]
        public void MovementCompletesAtTheRequestedDistance(string command, double distance, double expected)
        {
            using var motion = new MotionController();
            var completion = motion.Command(command, new[] { distance });
            motion.Tick(0.25f);
            Assert.That(completion.IsCompleted, Is.False);
            Assert.That(motion.Transform.Position.X, Is.EqualTo(expected / 2).Within(0.001));
            motion.Tick(0.25f);
            Assert.That(completion.IsCompletedSuccessfully, Is.True);
            Assert.That(motion.Transform.Position.X, Is.EqualTo(expected).Within(0.001));
        }

        [TestCase("left", 90, 90)]
        [TestCase("right", 90, 270)]
        [TestCase("left", -90, 270)]
        [TestCase("right", -90, 90)]
        public void RotationUsesStudentDegrees(string command, double degrees, double expected)
        {
            using var motion = new MotionController();
            var completion = motion.Command(command, new[] { degrees });
            motion.Tick(0.5f);
            Assert.That(completion.IsCompletedSuccessfully, Is.True);
            Assert.That(motion.Heading, Is.EqualTo(expected).Within(0.001));
        }

        [TestCase("left")]
        [TestCase("right")]
        public void AFullTurnStillTakesTwoSeconds(string command)
        {
            using var motion = new MotionController();
            var completion = motion.Command(command, new[] { 360.0 });
            motion.Tick(1);
            Assert.That(completion.IsCompleted, Is.False);
            Assert.That(motion.Heading, Is.EqualTo(180).Within(0.001));
            motion.Tick(1);
            Assert.That(completion.IsCompletedSuccessfully, Is.True);
            Assert.That(motion.Heading, Is.EqualTo(0).Within(0.001));
        }

        [Test]
        public void ZeroCommandsCompleteImmediately()
        {
            using var motion = new MotionController();
            foreach (var command in new[] { "forward", "backward", "left", "right" })
                Assert.That(motion.Command(command, new[] { 0.0 }).IsCompletedSuccessfully, Is.True);
            Assert.That(motion.Command("goto", new[] { 0.0, 0.0 }).IsCompletedSuccessfully, Is.True);
        }

        [Test]
        public void GotoAllowsOutsideCoordinatesAndPreservesHeading()
        {
            using var motion = new MotionController();
            motion.Command("left", new[] { 90.0 });
            motion.Tick(0.5f);
            var completion = motion.Command("goto", new[] { 900.0, -700.0 });
            motion.Tick(10);
            Assert.That(completion.IsCompletedSuccessfully, Is.True);
            Assert.That(motion.Transform.Position.X, Is.EqualTo(900));
            Assert.That(motion.Transform.Position.Y, Is.EqualTo(-700));
            Assert.That(motion.Heading, Is.EqualTo(90).Within(0.001));
        }

        [Test]
        public void CancelPreservesPositionAndResetReturnsToOrigin()
        {
            using var motion = new MotionController();
            var completion = motion.Command("forward", new[] { 1000.0 });
            motion.Tick(0.5f);
            motion.Cancel();
            motion.Tick(1);
            Assert.That(completion.IsCanceled, Is.True);
            Assert.That(motion.Transform.Position.X, Is.EqualTo(100));
            motion.Reset();
            Assert.That(motion.Transform.Position.X, Is.Zero);
            Assert.That(motion.Transform.Position.Y, Is.Zero);
            Assert.That(motion.Heading, Is.Zero);
        }

        [Test]
        public void EventSubscriptionCanBeReleased()
        {
            using var motion = new MotionController();
            var count = 0;
            var subscription = motion.Subscribe(_ => count++);
            motion.Command("forward", new[] { 100.0 });
            motion.Tick(0.25f);
            Assert.That(count, Is.EqualTo(1));
            subscription.Dispose();
            motion.Tick(0.25f);
            Assert.That(count, Is.EqualTo(1));
        }

        [Test]
        public void ConcurrentCommandsAreRejected()
        {
            using var motion = new MotionController();
            motion.Command("forward", new[] { 100.0 });
            Assert.Throws<InvalidOperationException>(() => motion.Command("left", new[] { 90.0 }));
        }

        [TestCase(double.NaN)]
        [TestCase(double.PositiveInfinity)]
        [TestCase(double.NegativeInfinity)]
        public void NonfiniteValuesAreRejected(double value)
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => MotionController.Validate("forward", new[] { value }));
        }
    }
}
