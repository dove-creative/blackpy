using System;
using System.Linq;
using BlackThunder.BlackPy;
using NUnit.Framework;

namespace BlackThunder.BlackPy.Tests
{
    [TestFixture]
    public class SimulationControllerTests
    {
        private SimulationController _simulation = null!;

        [SetUp]
        public void SetUp() => _simulation = new SimulationController();

        [TearDown]
        public void TearDown() => _simulation.EndRun();

        [Test]
        public void ExchangesDoNotAdvanceTimeAndTicksContinueWithoutPython()
        {
            var request = Begin(Actor(1, mode: "물리"));
            for (int i = 0; i < 100; i++) Send(request);
            Assert.That(_simulation.Snapshot().Elapsed, Is.Zero);
            Assert.That(_simulation.Snapshot().Actors[0].Y, Is.Zero);

            for (int i = 0; i < 30; i++) _simulation.Tick(1.0 / 60);
            var result = _simulation.Snapshot();
            Assert.That(result.Tick, Is.EqualTo(30));
            Assert.That(result.Elapsed, Is.EqualTo(0.5).Within(1e-10));
            Assert.That(result.Actors[0].Y, Is.InRange(-130, -120));
        }

        [Test]
        public void InitializationReturnsAllActorsWithoutStartingGravity()
        {
            _simulation.BeginRun("run", 2);
            var request = Request(Actor(2, 40, mode: "물리"), Actor(1, -40));
            request.Ready = false;
            var result = _simulation.Exchange(request);
            _simulation.Tick(1);
            Assert.That(result.Actors.Select(actor => actor.Id), Is.EqualTo(new[] { "actor-1", "actor-2" }));
            Assert.That(result.Actors[1].X, Is.EqualTo(40).Within(1e-5));
            Assert.That(_simulation.Snapshot().Elapsed, Is.Zero);
            request.Ready = true;
            Send(request);
            _simulation.Tick(1.0 / 60);
            Assert.That(_simulation.Snapshot().Actors[1].Y, Is.LessThan(0));
        }

        [Test]
        public void LongPauseConsumesOnlyTheBoundedPhysicsBudget()
        {
            Begin(Actor(1, mode: "물리"));
            _simulation.Tick(10);
            var result = _simulation.Snapshot();
            Assert.That(result.Tick, Is.EqualTo(1));
            Assert.That(result.Elapsed, Is.EqualTo(0.1).Within(1e-12));
            Assert.That(result.Actors[0].Y, Is.InRange(-6, -4));
        }

        [Test]
        public void FiniteMotionsCombineAndCompleteAfterTheFinalPosition()
        {
            var request = Begin(Actor(1));
            request.Commands = new[] { Motion("first", 100, 0, 0.5), Motion("second", 0, 50, 0.25) };
            Send(request);
            for (int i = 0; i < 15; i++) _simulation.Tick(1.0 / 60);
            var middle = _simulation.Snapshot();
            Assert.That(middle.Actors[0].X, Is.EqualTo(50).Within(1e-9));
            Assert.That(middle.Actors[0].Y, Is.EqualTo(50).Within(1e-9));
            Assert.That(middle.Completed, Is.EqualTo(new[] { "second" }));

            request.Commands = new[] { Command("teleport", 200, 80) };
            Send(request);
            for (int i = 0; i < 15; i++) _simulation.Tick(1.0 / 60);
            var final = _simulation.Snapshot();
            Assert.That(final.Actors[0].X, Is.EqualTo(250).Within(1e-9));
            Assert.That(final.Completed, Is.EqualTo(new[] { "second", "first" }));
            request.Commands = Array.Empty<SimulationCommand>();
            request.AcknowledgedCompletions = final.Completed;
            Assert.That(Send(request).Completed, Is.Empty);
        }

        [Test]
        public void BlockedFiniteMotionStillCompletesAndStopDoesNotCancelIt()
        {
            var request = Begin(Actor(1, 360, mode: "물리"));
            request.Commands = new[] { Motion("wall", 100, 0, 0.2), Command("stop") };
            Send(request);
            _simulation.Tick(0.1);
            _simulation.Tick(0.1);
            var result = _simulation.Snapshot();
            Assert.That(result.Actors[0].X, Is.InRange(378, 381));
            Assert.That(result.Completed, Is.EqualTo(new[] { "wall" }));
        }

        [Test]
        public void RatesReplaceWithinASourceCombineAcrossSourcesAndRejectOldRevisions()
        {
            var request = Begin(Actor(1));
            var right = Accept("keydown", "오른쪽");
            var up = Accept("keydown", "위");
            request.Commands = new[]
            {
                Rate("key:오른쪽", right.Generation, 2, 100, 0),
                Rate("key:오른쪽", right.Generation, 1, 900, 0),
                Rate("key:위", up.Generation, 1, 0, 50)
            };
            Send(request);
            _simulation.Tick(0.1);
            Assert.That(_simulation.Snapshot().Actors[0].X, Is.EqualTo(10));
            Assert.That(_simulation.Snapshot().Actors[0].Y, Is.EqualTo(5));
            request.Commands = new[] { Rate("key:오른쪽", right.Generation, 2, 30, 0) };
            Send(request);
            _simulation.Tick(0.1);
            Assert.That(_simulation.Snapshot().Actors[0].X, Is.EqualTo(13));
            request.Commands = new[] { Rate("key:오른쪽", right.Generation, 3, 0, 0) };
            Send(request);
            _simulation.Tick(0.1);
            Assert.That(_simulation.Snapshot().Actors[0].X, Is.EqualTo(13));
        }

        [TestCase("keyup")]
        [TestCase("reset")]
        public void ReleaseRevokesRatesImmediatelyAndOldGenerationCannotReviveThem(string kind)
        {
            var request = Begin(Actor(1));
            var pressed = Accept("keydown", "오른쪽");
            request.Commands = new[] { Rate("key:오른쪽", pressed.Generation, 1, 100, 0) };
            Send(request);
            _simulation.Tick(0.1);
            Accept(kind, kind == "keyup" ? "오른쪽" : "");
            _simulation.Tick(0.1);
            Assert.That(_simulation.Snapshot().Actors[0].X, Is.EqualTo(10));
            var next = Accept("keydown", "오른쪽");
            Assert.That(next.Generation, Is.GreaterThan(pressed.Generation));
            request.Commands[0].Revision = 100;
            Send(request);
            _simulation.Tick(0.1);
            Assert.That(_simulation.Snapshot().Actors[0].X, Is.EqualTo(10));
        }

        [Test]
        public void PointerHitUsesServerPositionAndReleaseRevokesItsRate()
        {
            var request = Begin(Actor(1, -100));
            request.Commands = new[] { Command("teleport", 100, 0) };
            Send(request);
            var down = new InputEvent(new InputRequest { Kind = "pointerdown", Button = "왼쪽", X = 100 });
            _simulation.Accept(down);
            Assert.That(down.TargetId, Is.EqualTo("actor-1"));
            request.Commands = new[] { Rate("pointer", down.Generation, 1, 100, 0) };
            Send(request);
            _simulation.Tick(0.1);
            _simulation.Accept(new InputEvent(new InputRequest { Kind = "pointerup", Button = "왼쪽" }));
            _simulation.Tick(0.1);
            Assert.That(_simulation.Snapshot().Actors[0].X, Is.EqualTo(110));
            Assert.That(_simulation.Snapshot().PointerId, Is.Null);
        }

        [Test]
        public void SceneAppearanceCannotOverwriteServerPoseOrPhysicalConfiguration()
        {
            var request = Begin(Actor(1));
            request.Commands = new[]
            {
                Command("teleport", 100, 40), Command("heading", 90), Command("resize", 80, 50),
                Command("visible", 0)
            };
            Send(request);
            request.Commands = Array.Empty<SimulationCommand>();
            request.Scene.Sprites[0].Speech = "새 말풍선";
            Send(request);
            var sprite = _simulation.Scene().Sprites[0];
            Assert.That(sprite.X, Is.EqualTo(100));
            Assert.That(sprite.Y, Is.EqualTo(40));
            Assert.That(sprite.Heading, Is.EqualTo(90));
            Assert.That(sprite.Width, Is.EqualTo(80));
            Assert.That(sprite.Visible, Is.False);
            Assert.That(sprite.Speech, Is.EqualTo("새 말풍선"));
        }

        [Test]
        public void ContactJournalRetainsTransientEdgesAndInvalidatesThePreviousRate()
        {
            var request = Begin(Actor(1), Actor(2, 100));
            request.Commands = new[] { Command("teleport", 80, 0) };
            var touching = Send(request);
            Assert.That(touching.Contacts.Select(contact => contact.Kind), Is.EqualTo(new[] { "enter", "enter" }));
            var generation = touching.Actors[0].ContactGeneration;
            request.Commands = new[] { Rate("contact:actor-1", generation, 1, 10, 0) };
            Send(request);
            request.Commands = new[] { Command("teleport", 0, 0) };
            var separated = Send(request);
            Assert.That(separated.Contacts.Select(contact => contact.Kind),
                Is.EqualTo(new[] { "enter", "enter", "exit", "exit" }));
            request.Commands = new[] { Rate("contact:actor-1", generation, 99, 1000, 0) };
            request.ContactAck = separated.Contacts[^1].Sequence;
            Assert.That(Send(request).Contacts, Is.Empty);
            _simulation.Tick(0.1);
            Assert.That(_simulation.Snapshot().Actors[0].X, Is.Zero);
        }

        [Test]
        public void OrderedMassAndImpulseRemainOrderedAndDuplicateSequenceDoesNotRepeatThem()
        {
            var request = Begin(Actor(1, mode: "물리"));
            request.Commands = new[] { Command("impulse", 1, 0), Command("mass", 10) };
            Send(request);
            _simulation.Exchange(request);
            _simulation.Tick(0.1);
            Assert.That(_simulation.Snapshot().Actors[0].X, Is.EqualTo(10).Within(0.01));
        }

        [Test]
        public void InvalidBatchDoesNotPartiallyApplyItsEarlierCommands()
        {
            var request = Begin(Actor(1, mode: "물리"));
            request.Commands = new[] { Command("impulse", 10, 0), Command("mass", 0) };
            request.Sequence++;
            Assert.Throws<BlackPyException>(() => _simulation.Exchange(request));
            request.Commands = Array.Empty<SimulationCommand>();
            _simulation.Exchange(request);
            _simulation.Tick(0.1);
            Assert.That(_simulation.Snapshot().Actors[0].X, Is.Zero.Within(1e-6));
        }

        [Test]
        public void ZeroDurationRotationAndHeadingKeepCommandOrder()
        {
            var request = Begin(Actor(1));
            var motion = Motion("rotate", 10, 0, 0);
            motion.Rotation = 45;
            request.Commands = new[] { Command("heading", 90), motion, Command("heading", 180) };
            var result = Send(request);
            Assert.That(result.Actors[0].X, Is.EqualTo(10));
            Assert.That(result.Actors[0].Heading, Is.EqualTo(180));
            Assert.That(result.Completed, Is.EqualTo(new[] { "rotate" }));
        }

        [Test]
        public void RestartClearsClockInputMotionsAndRejectsThePreviousRun()
        {
            var request = Begin(Actor(1));
            request.Commands = new[] { Motion("pending", 100, 0, 1) };
            Send(request);
            Accept("keydown", "오른쪽");
            _simulation.Tick(0.1);
            _simulation.BeginRun("next", 1);
            Assert.Throws<BlackPyException>(() => _simulation.Exchange(request));
            var next = Request(Actor(1));
            next.RunId = "next";
            var result = _simulation.Exchange(next);
            Assert.That(result.Elapsed, Is.Zero);
            Assert.That(result.Keys, Is.Empty);
            Assert.That(result.Completed, Is.Empty);
            Assert.That(result.Contacts, Is.Empty);
            _simulation.Tick(0.1);
            Assert.That(_simulation.Snapshot().Actors[0].X, Is.Zero);
        }

        [Test]
        public void LongMotionsAndFiniteRatesAreValidatedAtTheirActualTickDisplacement()
        {
            var request = Begin(Actor(1));
            var key = Accept("keydown", "오른쪽");
            request.Commands = new[]
            {
                Motion("long", 100, 0, 100000), Rate("key:오른쪽", key.Generation, 1, 200000, 0)
            };
            Assert.DoesNotThrow(() => Send(request));
            _simulation.Tick(0.01);
            Assert.That(_simulation.Snapshot().Actors[0].X, Is.EqualTo(2000.00001).Within(1e-6));
            Assert.That(_simulation.Snapshot().Completed, Is.Empty);
        }

        private SimulationExchangeRequest Begin(params PhysicsActorState[] actors)
        {
            _simulation.BeginRun("run", actors.Length);
            var request = Request(actors);
            _simulation.Exchange(request);
            return request;
        }

        private SimulationExchangeResult Send(SimulationExchangeRequest request)
        {
            request.Sequence++;
            return _simulation.Exchange(request);
        }

        private InputEvent Accept(string kind, string key = "")
        {
            var input = new InputEvent(new InputRequest { Kind = kind, Key = key });
            _simulation.Accept(input);
            return input;
        }

        private static SimulationExchangeRequest Request(params PhysicsActorState[] actors) => new()
        {
            RunId = "run", Sequence = 1, Ready = true, Actors = actors,
            Scene = new SceneState
            {
                Sprites = actors.Select(actor => new SpriteState
                {
                    Id = actor.Id, X = actor.X, Y = actor.Y, Width = actor.Width, Height = actor.Height
                }).ToArray()
            }
        };

        private static PhysicsActorState Actor(int index, double x = 0, double y = 0, string mode = "충돌만") => new()
        {
            Id = "actor-" + index, X = x, Y = y, Width = 40, Height = 40, Mode = mode
        };

        private static SimulationCommand Command(string kind, double x = 0, double y = 0) => new()
        {
            Id = "actor-1", Kind = kind, X = x, Y = y
        };

        private static SimulationCommand Motion(string token, double x, double y, double duration) => new()
        {
            Id = "actor-1", Kind = "motion", Token = token, X = x, Y = y, Duration = duration
        };

        private static SimulationCommand Rate(string source, long generation, long revision, double x, double y) => new()
        {
            Id = "actor-1", Kind = "rate", Source = source, Generation = generation, Revision = revision, X = x, Y = y
        };
    }
}
