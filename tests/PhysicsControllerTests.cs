using System;
using BlackThunder.BlackPy;
using NUnit.Framework;

namespace BlackThunder.BlackPy.Tests
{
    [TestFixture]
    public class PhysicsControllerTests
    {
        private PhysicsController _physics = null!;

        [SetUp]
        public void SetUp() => _physics = new PhysicsController();

        [TearDown]
        public void TearDown() => _physics.EndRun();

        [Test]
        public void DynamicBodyFallsAndSettlesOnTheStageFloor()
        {
            _physics.BeginRun("run", 1);
            var actor = Actor(1, "물리");
            var first = Step(0.2, new[] { actor }).Actors[0];
            Assert.That(first.Y, Is.InRange(-25, -15));
            var resting = Step(3, new[] { actor }).Actors[0];
            Assert.That(resting.Y, Is.EqualTo(-275).Within(0.8));
            Assert.That(resting.X, Is.EqualTo(0).Within(0.001));
            Assert.That(resting.Contacts, Is.Empty, "Stage walls are not student objects.");
        }

        [Test]
        public void ImpulseChangesVelocityOnceAndRespectsMass()
        {
            _physics.BeginRun("run", 2);
            var light = Actor(1, "물리", -200, 100);
            var heavy = Actor(2, "물리", -200, -100);
            heavy.Mass = 2;
            var state = Step(0.1, new[] { light, heavy },
                Command(1, "impulse", 1, 0), Command(2, "impulse", 1, 0));
            var lightTravel = state.Actors[0].X + 200;
            var heavyTravel = state.Actors[1].X + 200;
            Assert.That(lightTravel, Is.EqualTo(10).Within(0.05));
            Assert.That(heavyTravel, Is.EqualTo(5).Within(0.05));
            var next = Step(0.1, new[] { light, heavy });
            Assert.That(next.Actors[0].X - state.Actors[0].X, Is.EqualTo(lightTravel).Within(0.05));
        }

        [Test]
        public void StopDoesNotDisableLaterGravityOrImpulse()
        {
            _physics.BeginRun("run", 1);
            var actors = new[] { Actor(1, "물리") };
            var moving = Step(0.1, actors, Command(1, "impulse", 2, 0)).Actors[0];
            var stopped = Step(0.1, actors, Command(1, "stop")).Actors[0];
            Assert.That(stopped.X, Is.EqualTo(moving.X).Within(0.001));
            Assert.That(stopped.Y, Is.LessThan(moving.Y));
            var restarted = Step(0.1, actors, Command(1, "impulse", 1, 0)).Actors[0];
            Assert.That(restarted.X, Is.GreaterThan(stopped.X + 9));
        }

        [TestCase(1, 375)]
        [TestCase(-1, -375)]
        public void SideWallsContainFastBodies(int direction, double expectedX)
        {
            _physics.BeginRun("run", 1);
            var state = Step(0.2, new[] { Actor(1, "물리") }, Command(1, "impulse", direction * 100, 0));
            Assert.That(state.Actors[0].X, Is.EqualTo(expectedX).Within(0.8));
        }

        [Test]
        public void TopWallContainsAnUpwardImpulse()
        {
            _physics.BeginRun("run", 1);
            var state = Step(0.05, new[] { Actor(1, "물리") }, Command(1, "impulse", 0, 100));
            Assert.That(state.Actors[0].Y, Is.InRange(274, 275.8));
        }

        [Test]
        public void CommandedMovementStopsAtAnotherBodyAndCanMoveAway()
        {
            _physics.BeginRun("run", 2);
            var actors = new[] { Actor(1, "물리", -100), Actor(2, "충돌만", 100) };
            var stopped = Step(0, actors, Command(1, "move", 400, 0));
            Assert.That(stopped.Actors[0].X, Is.EqualTo(50).Within(0.8));
            Assert.That(stopped.Actors[0].Contacts, Is.EqualTo(new[] { "actor-2" }));
            var away = Step(0, actors, Command(1, "move", -50, 0));
            Assert.That(away.Actors[0].X, Is.EqualTo(stopped.Actors[0].X - 50).Within(0.001));
        }

        [Test]
        public void CommandedMovementCanSlideAlongTheFloor()
        {
            _physics.BeginRun("run", 1);
            var actors = new[] { Actor(1, "물리", 0, -275) };
            Step(1, actors);
            var state = Step(0, actors, Command(1, "move", 100, 0));
            Assert.That(state.Actors[0].X, Is.EqualTo(100).Within(0.001));
        }

        [Test]
        public void CollisionOnlyBodiesIgnoreGravityAndImpulseButBlockDynamicBodies()
        {
            _physics.BeginRun("run", 2);
            var actors = new[] { Actor(1, "물리", 0, 100), Actor(2, "충돌만", 0, -100) };
            var state = Step(2, actors, Command(2, "impulse", 10, 10));
            Assert.That(state.Actors[1].X, Is.EqualTo(0));
            Assert.That(state.Actors[1].Y, Is.EqualTo(-100));
            Assert.That(state.Actors[0].Y, Is.EqualTo(-50).Within(0.8));
            Assert.That(state.Actors[0].Contacts, Is.EqualTo(new[] { "actor-2" }));
        }

        [Test]
        public void CollisionOnlyObjectsStillReportEachOtherInProjectOrder()
        {
            _physics.BeginRun("run", 3);
            var actors = new[] { Actor(3, "충돌만", -10), Actor(1, "충돌만"), Actor(2, "충돌만", 10) };
            var state = Step(0, actors);
            Assert.That(state.Actors[0].Id, Is.EqualTo("actor-1"));
            Assert.That(state.Actors[0].Contacts, Is.EqualTo(new[] { "actor-2", "actor-3" }));
            Assert.That(state.Actors[1].Contacts, Is.EqualTo(new[] { "actor-1", "actor-3" }));
        }

        [Test]
        public void TallBodyRemainsUprightOnAnOffCenterSupport()
        {
            _physics.BeginRun("run", 2);
            var falling = Actor(1, "물리", 0, 150);
            falling.Width = 50;
            falling.Height = 150;
            var support = Actor(2, "충돌만", 30, 0);
            support.Width = 50;
            support.Height = 20;
            var state = Step(3, new[] { falling, support });
            Assert.That(state.Actors[0].X, Is.EqualTo(0).Within(0.001));
            Assert.That(state.Actors[0].Y, Is.EqualTo(85).Within(0.8));
            Assert.That(state.Actors[0].Contacts, Is.EqualTo(new[] { "actor-2" }));
        }

        [Test]
        public void NoneModeCanOverlapAndLeaveTheStageWithoutContacts()
        {
            _physics.BeginRun("run", 2);
            var actors = new[] { Actor(1, "없음"), Actor(2, "충돌만") };
            Assert.That(Step(0, actors).Actors[0].Contacts, Is.Empty);
            var state = Step(1, actors, Command(1, "move", 1000, 0));
            Assert.That(state.Actors[0].X, Is.EqualTo(1000));
            Assert.That(state.Actors[0].Y, Is.EqualTo(0));
        }

        [Test]
        public void NonPhysicalCoordinatesKeepDoublePrecision()
        {
            _physics.BeginRun("run", 1);
            var actors = new[] { Actor(1, "충돌만", 0.123456789) };
            var state = Step(0, actors, Command(1, "move", 0.000000123, 0));
            Assert.That(state.Actors[0].X, Is.EqualTo(0.123456912).Within(1e-12));
        }

        [Test]
        public void LaterSnapshotsDoNotResetTheEnginePosition()
        {
            _physics.BeginRun("run", 1);
            var actors = new[] { Actor(1, "물리") };
            var first = Step(0.1, actors, Command(1, "impulse", 1, 0)).Actors[0];
            actors[0].X = -200;
            var next = Step(0.1, actors).Actors[0];
            Assert.That(next.X, Is.EqualTo(first.X + 10).Within(0.02));
        }

        [Test]
        public void ModeChangesClearTheOldVelocity()
        {
            _physics.BeginRun("run", 1);
            var actors = new[] { Actor(1, "물리") };
            var first = Step(0.1, actors, Command(1, "impulse", 1, 0)).Actors[0];
            actors[0].Mode = "충돌만";
            var fixedPosition = Step(1, actors).Actors[0];
            Assert.That(fixedPosition.X, Is.EqualTo(first.X).Within(0.001));
            actors[0].Mode = "물리";
            var falling = Step(0.1, actors).Actors[0];
            Assert.That(falling.X, Is.EqualTo(first.X).Within(0.001));
            Assert.That(falling.Y, Is.LessThan(first.Y));
        }

        [Test]
        public void MassChangeAfterAnImpulseDoesNotChangeItsInitialVelocity()
        {
            _physics.BeginRun("run", 1);
            var actors = new[] { Actor(1, "물리") };
            var state = Step(0.1, actors, Command(1, "impulse", 1, 0), Command(1, "mass", 10));
            Assert.That(state.Actors[0].X, Is.EqualTo(10).Within(0.05));
            Assert.That(actors[0].Mass, Is.EqualTo(1), "Sequence validation must not mutate its input.");
            actors[0].Mass = 10;
            var next = Step(0.1, actors, Command(1, "impulse", 1, 0));
            Assert.That(next.Actors[0].X - state.Actors[0].X, Is.EqualTo(11).Within(0.05));
        }

        [Test]
        public void SwitchingPhysicsOffAndOnInOneBatchClearsVelocity()
        {
            _physics.BeginRun("run", 1);
            var actors = new[] { Actor(1, "물리") };
            var state = Step(0.1, actors,
                Command(1, "impulse", 1, 0), Mode(1, "없음"), Mode(1, "물리"));
            Assert.That(state.Actors[0].X, Is.EqualTo(0).Within(0.001));
            Assert.That(state.Actors[0].Y, Is.LessThan(0));
        }

        [Test]
        public void RepeatingTheSameModeDoesNotClearVelocity()
        {
            _physics.BeginRun("run", 1);
            var state = Step(0.1, new[] { Actor(1, "물리") }, Command(1, "impulse", 1, 0), Mode(1, "물리"));
            Assert.That(state.Actors[0].X, Is.EqualTo(10).Within(0.05));
        }

        [Test]
        public void HidingAndShowingInOneBatchClearsVelocity()
        {
            _physics.BeginRun("run", 1);
            var actors = new[] { Actor(1, "물리") };
            var state = Step(0.1, actors,
                Command(1, "impulse", 1, 0), Command(1, "visible", 0), Command(1, "visible", 1));
            Assert.That(state.Actors[0].X, Is.EqualTo(0).Within(0.001));
            Assert.That(state.Actors[0].Y, Is.LessThan(0));
        }

        [Test]
        public void ResizeAndModeCommandsValidateTheirIntermediateConfiguration()
        {
            var invalidSequences = new[]
            {
                new[] { Command(1, "resize", 900, 50), Mode(1, "물리") },
                new[] { Mode(1, "물리"), Command(1, "resize", 900, 50), Command(1, "resize", 50, 50) },
                new[] { Mode(1, "unknown") },
                new[] { Command(1, "mass", 0) },
                new[] { Command(1, "visible", 2) }
            };

            foreach (PhysicsCommand[] sequence in invalidSequences)
            {
                _physics.BeginRun("run", 1);
                var actors = new[] { Actor(1) };
                Step(0, actors);
                var commands = new PhysicsCommand[sequence.Length + 1];
                commands[0] = Command(1, "move", 100, 0);
                Array.Copy(sequence, 0, commands, 1, sequence.Length);
                Assert.Throws<BlackPyException>(() => Step(0, actors, commands));
                Assert.That(Step(0, actors).Actors[0].X, Is.EqualTo(0));
                Assert.That(actors[0].Width, Is.EqualTo(50));
                Assert.That(actors[0].Mode, Is.EqualTo("충돌만"));
            }
        }

        [Test]
        public void NonPhysicalResizeCanBeReducedBeforeEnteringPhysics()
        {
            _physics.BeginRun("run", 1);
            var state = Step(0.1, new[] { Actor(1, "없음") },
                Command(1, "resize", 900, 50), Command(1, "resize", 100, 50), Mode(1, "물리"));
            Assert.That(state.Actors[0].Y, Is.LessThan(0));
        }

        [Test]
        public void HiddenBodiesPauseAndLoseContactsThenResumeWithoutOldVelocity()
        {
            _physics.BeginRun("run", 2);
            var actors = new[] { Actor(1, "물리"), Actor(2, "충돌만", 30) };
            Assert.That(Step(0, actors).Actors[0].Contacts, Is.Not.Empty);
            actors[0].Visible = false;
            var hidden = Step(1, actors, Command(1, "impulse", 10, 0)).Actors[0];
            Assert.That(hidden.Contacts, Is.Empty);
            Assert.That(hidden.Y, Is.EqualTo(0));
            actors[0].Visible = true;
            actors[1].Mode = "없음";
            var shown = Step(0.1, actors).Actors[0];
            Assert.That(shown.X, Is.EqualTo(hidden.X).Within(0.001));
            Assert.That(shown.Y, Is.LessThan(hidden.Y));
        }

        [Test]
        public void ResizingChangesContactsAndPreservesTheConfiguredMass()
        {
            _physics.BeginRun("run", 2);
            var actors = new[] { Actor(1, "물리"), Actor(2, "충돌만", 80) };
            actors[0].Mass = 2;
            Assert.That(Step(0, actors).Actors[0].Contacts, Is.Empty);
            actors[0].Width = 120;
            Assert.That(Step(0, actors).Actors[0].Contacts, Is.Not.Empty);
            actors[1].Mode = "없음";
            var state = Step(0.1, actors, Command(1, "impulse", 1, 0)).Actors[0];
            Assert.That(state.X, Is.EqualTo(5).Within(0.05));
        }

        [Test]
        public void TeleportClampsPhysicalBodiesAndKeepsCommandOrder()
        {
            _physics.BeginRun("run", 1);
            var actors = new[] { Actor(1, "물리") };
            var state = Step(0, actors, Command(1, "teleport", 1000, 1000), Command(1, "move", -25, -25));
            Assert.That(state.Actors[0].X, Is.EqualTo(350).Within(0.001));
            Assert.That(state.Actors[0].Y, Is.EqualTo(250).Within(0.001));
            var stopped = Step(0.1, actors, Command(1, "impulse", 1, 0), Command(1, "stop"));
            Assert.That(stopped.Actors[0].X, Is.EqualTo(350).Within(0.001));
        }

        [Test]
        public void FixedStepsAgreeAtThirtySixtyAndOneHundredTwentyUpdates()
        {
            double? expectedX = null;
            double? expectedY = null;

            foreach (int frequency in new[] { 30, 60, 120 })
            {
                _physics.BeginRun("run", 1);
                var actors = new[] { Actor(1, "물리", 0, 150) };
                Step(0, actors, Command(1, "impulse", 1, 0));
                PhysicsStepResult state = null!;
                for (int i = 0; i < frequency / 2; i++) state = Step(1.0 / frequency, actors);
                expectedX ??= state.Actors[0].X;
                expectedY ??= state.Actors[0].Y;
                Assert.That(state.Actors[0].X, Is.EqualTo(expectedX.Value).Within(0.001));
                Assert.That(state.Actors[0].Y, Is.EqualTo(expectedY.Value).Within(0.001));
            }
        }

        [Test]
        public void InvalidRequestsDoNotPartiallyApplyCommands()
        {
            _physics.BeginRun("run", 1);
            var actors = new[] { Actor(1, "충돌만") };
            Step(0, actors);
            Assert.Throws<BlackPyException>(() => Step(0, actors,
                Command(1, "move", 100, 0), Command(1, "impulse", double.NaN, 0)));
            Assert.That(Step(0, actors).Actors[0].X, Is.EqualTo(0));
        }

        [TestCase("invalid", 1)]
        [TestCase("물리", 0)]
        [TestCase("물리", double.PositiveInfinity)]
        public void InvalidModesAndMassAreRejected(string mode, double mass)
        {
            _physics.BeginRun("run", 1);
            var actor = Actor(1, mode);
            actor.Mass = mass;
            Assert.Throws<BlackPyException>(() => Step(0, new[] { actor }));
        }

        [Test]
        public void DuplicateActorsAndUnknownCommandsAreRejected()
        {
            _physics.BeginRun("run", 2);
            Assert.Throws<BlackPyException>(() => Step(0, new[] { Actor(1), Actor(1) }));
            Assert.Throws<BlackPyException>(() => Step(0, new[] { Actor(1), Actor(2) }, Command(3, "stop")));
        }

        [Test]
        public void RestartRejectsOldRequestsAndResetsTimeAndBodies()
        {
            _physics.BeginRun("run", 1);
            Step(0.1, new[] { Actor(1, "물리") }, Command(1, "impulse", 1, 0));
            _physics.EndRun();
            Assert.Throws<BlackPyException>(() => Step(0, new[] { Actor(1) }));
            _physics.BeginRun("new", 1);
            Assert.Throws<BlackPyException>(() => Step(0, new[] { Actor(1) }));
            var state = _physics.Step(new PhysicsStepRequest
            {
                RunId = "new", Actors = new[] { Actor(1, "물리", 50, 50) }
            });

            Assert.That(state.Actors[0].X, Is.EqualTo(50).Within(0.001));
            Assert.That(state.Actors[0].Y, Is.EqualTo(50).Within(0.001));
        }

        [Test]
        public void SolidKinematicMoveStopsAtWallAndCanReverse()
        {
            _physics.BeginRun("run", 2);
            var actors = new[] { Actor(1), Actor(2, x: 100) };
            var hit = Step(0, actors, Command(1, "move", 500));
            Assert.That(hit.Actors[0].X, Is.EqualTo(50).Within(0.8));
            Assert.That(hit.Actors[0].Contacts, Is.EqualTo(new[] { "actor-2" }));
            var back = Step(0, actors, Command(1, "move", -25));
            Assert.That(back.Actors[0].X, Is.EqualTo(25).Within(0.8));
            Assert.That(back.Actors[0].Contacts, Is.Empty);
        }

        [TestCase(true, false)]
        [TestCase(false, true)]
        public void EitherTriggerAllowsPassageAndStillReportsContact(bool first, bool second)
        {
            _physics.BeginRun("run", 2);
            var actors = new[] { Actor(1), Actor(2, x: 100) };
            actors[0].Trigger = first;
            actors[1].Trigger = second;
            var overlap = Step(0, actors, Command(1, "move", 100));
            Assert.That(overlap.Actors[0].X, Is.EqualTo(100));
            Assert.That(overlap.Actors[0].Contacts, Is.EqualTo(new[] { "actor-2" }));
            Assert.That(Step(0, actors, Command(1, "move", 100)).Actors[0].Contacts, Is.Empty);
        }

        [Test]
        public void RotatedRectangleUsesItsOrientedCollider()
        {
            _physics.BeginRun("run", 2);
            var car = Actor(1);
            car.Width = 120;
            car.Height = 30;
            car.Heading = 90;
            var actors = new[] { car, Actor(2, x: 65) };
            Assert.That(Step(0, actors).Actors[0].Contacts, Is.Empty);
            var hit = Step(0, actors, Command(1, "move", 200));
            Assert.That(hit.Actors[0].X, Is.EqualTo(25).Within(0.8));
            Assert.That(hit.Actors[0].Heading, Is.EqualTo(90));
        }

        [Test]
        public void RotationStopsBeforeCornerPenetratesAndCanTurnAway()
        {
            _physics.BeginRun("run", 2);
            var car = Actor(1);
            car.Width = 120;
            car.Height = 30;
            var wall = Actor(2, y: 65);
            wall.Width = 300;
            var actors = new[] { car, wall };
            var hit = Step(0, actors, new PhysicsCommand { Id = car.Id, Kind = "move", Rotation = 180 });
            Assert.That(hit.Actors[0].Heading, Is.InRange(10, 45));
            Assert.That(hit.Actors[0].Contacts, Is.EqualTo(new[] { wall.Id }));
            var released = Step(0, actors, new PhysicsCommand { Id = car.Id, Kind = "move", Rotation = -10 });
            Assert.That(released.Actors[0].Heading, Is.LessThan(hit.Actors[0].Heading - 9));
        }

        [Test]
        public void TriggerDynamicBodyFallsThroughSolidPlatformAndModeCanRestoreBlocking()
        {
            _physics.BeginRun("run", 2);
            var body = Actor(1, "물리", y: 100);
            body.Trigger = true;
            var actors = new[] { body, Actor(2) };
            Assert.That(Step(0.8, actors).Actors[0].Y, Is.LessThan(-100));
            var mode = Mode(1, "충돌만");
            var result = Step(0, actors, mode, Command(1, "teleport", -100), Command(1, "move", 200));
            Assert.That(result.Actors[0].X, Is.EqualTo(-50).Within(0.8));
        }

        private PhysicsStepResult Step(double time, PhysicsActorState[] actors, params PhysicsCommand[] commands) =>
            _physics.Step(new PhysicsStepRequest
            {
                RunId = "run", DeltaTime = time, Actors = actors, Commands = commands
            });

        private static PhysicsActorState Actor(int id, string mode = "충돌만", double x = 0, double y = 0) =>
            new() { Id = "actor-" + id, Mode = mode, X = x, Y = y, Width = 50, Height = 50 };

        private static PhysicsCommand Command(int id, string kind, double x = 0, double y = 0) =>
            new() { Id = "actor-" + id, Kind = kind, X = x, Y = y };

        private static PhysicsCommand Mode(int id, string mode) =>
            new() { Id = "actor-" + id, Kind = "mode", Mode = mode };
    }
}
