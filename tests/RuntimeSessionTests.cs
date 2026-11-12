using System;
using System.Threading.Tasks;
using BlackThunder.BlackPy;
using NUnit.Framework;

namespace BlackThunder.BlackPy.Tests
{
    [TestFixture]
    public class RuntimeSessionTests
    {
        [Test]
        public async Task IdleSessionWakesForRequestsAndShutdown()
        {
            await using var session = new RuntimeSession(".", new PythonCommand("unused"), "", "");
            for (int i = 0; i < 32; i++)
            {
                var state = await session.GetStateAsync().WaitAsync(TimeSpan.FromSeconds(2));
                Assert.That(state.Status, Is.EqualTo("ready"));
                await Task.Yield();
            }

            await session.ShutdownAsync().WaitAsync(TimeSpan.FromSeconds(2));
            Assert.ThrowsAsync<BlackPyException>(async () => await session.GetStateAsync());
        }

        [Test]
        public async Task BurstBeyondTheQueueCapacityDrainsWithoutLosingWakeups()
        {
            await using var session = new RuntimeSession(".", new PythonCommand("unused"), "", "");
            var pending = new Task<StateMessage>[2048];
            for (int i = 0; i < pending.Length; i++) pending[i] = session.GetStateAsync();

            var states = await Task.WhenAll(pending).WaitAsync(TimeSpan.FromSeconds(5));
            Assert.That(states.Length, Is.EqualTo(pending.Length));
            foreach (StateMessage state in states) Assert.That(state.Status, Is.EqualTo("ready"));
        }

        [Test]
        public async Task IdleSessionObservesTheFirstBrowserDeadlineWithoutIncomingRequests()
        {
            var stopped = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            await using var session = new RuntimeSession(
                ".", new PythonCommand("unused"), "", "",
                () => stopped.TrySetResult(true), TimeSpan.FromMilliseconds(40));

            Assert.That(await stopped.Task.WaitAsync(TimeSpan.FromSeconds(2)), Is.True);
        }

        [Test]
        public async Task FrameBurstPublishesTheLatestSceneAndRestartDoesNotReplayIt()
        {
            using var directory = new ProjectTestDirectory();
            var python = ProjectTestDirectory.PassivePython(await PythonCommand.ResolveAsync());
            await using var session = new RuntimeSession(directory.Path, python, "http://127.0.0.1:1", "test-token");
            var browser = await session.ConnectAsync();
            var first = await session.RunAsync();
            var pending = new Task<StateMessage>[512];
            for (int i = 0; i < pending.Length; i++)
            {
                pending[i] = session.FrameAsync(new SceneFrameRequest
                {
                    RunId = first.RunId!,
                    Scene = new SceneState { Message = "frame-" + i }
                });
            }

            await Task.WhenAll(pending).WaitAsync(TimeSpan.FromSeconds(5));
            StateMessage published;
            do
            {
                published = await browser.Messages.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
            } while (published.Scene.Message != "frame-511");

            Assert.That(published.RunId, Is.EqualTo(first.RunId));
            await session.StopAsync();
            var second = await session.RunAsync();
            do
            {
                published = await browser.Messages.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
            } while (published.RunId != second.RunId);

            Assert.That(published.Status, Is.EqualTo("running"));
            Assert.That(published.Scene.Active, Is.False);
            Assert.That(published.Scene.Message, Is.Empty);
        }

        [Test]
        public async Task IndependentTicksMoveTheSceneWithoutPythonRequestsAndRejectDirectPhysicsSteps()
        {
            using var directory = new ProjectTestDirectory();
            var python = ProjectTestDirectory.PassivePython(await PythonCommand.ResolveAsync());
            await using var session = new RuntimeSession(directory.Path, python, "http://127.0.0.1:1", "test-token");
            var browser = await session.ConnectAsync();
            var running = await session.RunAsync();
            var request = Exchange(running.RunId!);
            request.Commands = new[]
            {
                new SimulationCommand { Id = "actor-1", Kind = "motion", Token = "move", X = 100, Duration = 0.1 }
            };
            await session.ExchangeAsync(request);

            StateMessage published;
            do
            {
                published = await browser.Messages.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
            } while (published.Scene.Sprites.Length == 0 || published.Scene.Sprites[0].X < 99.9);

            request.Sequence++;
            request.Commands = Array.Empty<SimulationCommand>();
            var result = await session.ExchangeAsync(request);
            Assert.That(result.Completed, Is.EqualTo(new[] { "move" }));
            Assert.That(result.Tick, Is.GreaterThanOrEqualTo(5));
            var rejected = Assert.ThrowsAsync<BlackPyException>(async () =>
                await session.PhysicsStepAsync(new PhysicsStepRequest { RunId = running.RunId! }));
            Assert.That(rejected!.StatusCode, Is.EqualTo(400));
            await session.StopAsync();
            rejected = Assert.ThrowsAsync<BlackPyException>(async () =>
                await session.PhysicsStepAsync(new PhysicsStepRequest { RunId = running.RunId! }));
            Assert.That(rejected!.StatusCode, Is.EqualTo(409));
        }

        [Test]
        public async Task SimulationFailureStopsTheStudentRunWithoutClosingTheHost()
        {
            using var directory = new ProjectTestDirectory();
            var python = ProjectTestDirectory.PassivePython(await PythonCommand.ResolveAsync());
            await using var session = new RuntimeSession(directory.Path, python, "http://127.0.0.1:1", "test-token");
            var browser = await session.ConnectAsync();
            var running = await session.RunAsync();
            var request = Exchange(running.RunId!);
            request.Ready = false;
            await session.ExchangeAsync(request);
            await session.InputAsync(new InputRequest { RunId = running.RunId!, Kind = "keydown", Key = "오른쪽" });
            var input = (await session.GetEventsAsync(running.RunId!))[0];
            request.Sequence++;
            request.Ready = true;
            request.Commands = new[]
            {
                new SimulationCommand
                {
                    Id = "actor-1", Kind = "rate", Source = "key:오른쪽", Generation = input.Generation,
                    Revision = 1, X = double.MaxValue
                }
            };
            await session.ExchangeAsync(request);
            StateMessage failed;
            do
            {
                failed = await browser.Messages.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
            } while (failed.Status != "error");

            Assert.That(failed.Error, Does.Contain("실행 명령 오류"));
            await session.StopAsync();
            Assert.That((await session.RunAsync()).Status, Is.EqualTo("running"));
        }

        private static SimulationExchangeRequest Exchange(string runId) => new()
        {
            RunId = runId, Sequence = 1, Ready = true,
            Actors = new[] { new PhysicsActorState { Id = "actor-1", Width = 40, Height = 40 } },
            Scene = new SceneState { Sprites = new[] { new SpriteState { Id = "actor-1", Width = 40, Height = 40 } } }
        };
    }
}
