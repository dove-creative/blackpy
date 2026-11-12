using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using BlackThunder.BlackPy;
using NUnit.Framework;

namespace BlackThunder.BlackPy.Tests
{
    [TestFixture]
    public class InputControllerTests
    {
        [Test]
        public void AcceptedEventsAreCopiedAndDrainedInOrder()
        {
            var input = new InputController();
            input.BeginRun("run");
            var request = Click("run", 25);
            input.Submit(request);
            request.X = 99;
            input.Submit(new InputRequest { RunId = "run", Kind = "keydown", Key = "오른쪽" });
            input.Submit(new InputRequest { RunId = "run", Kind = "pointerup", Button = "왼쪽", X = 30 });
            input.Submit(new InputRequest { RunId = "run", Kind = "keyup", Key = "오른쪽" });
            var events = input.Drain("run");

            Assert.That(events.Length, Is.EqualTo(4));
            Assert.That(events[0].X, Is.EqualTo(25));
            Assert.That(events[0].Button, Is.EqualTo("왼쪽"));
            Assert.That(events[1].Key, Is.EqualTo("오른쪽"));
            Assert.That(events[2].Kind, Is.EqualTo("pointerup"));
            Assert.That(events[3].Kind, Is.EqualTo("keyup"));
            Assert.That(input.Drain("run"), Is.Empty);
        }

        [Test]
        public void PointerUpdatesCoalesceWithoutCrossingAClick()
        {
            var input = new InputController();
            input.BeginRun("run");
            input.Submit(Pointer(10));
            input.Submit(Pointer(20));
            input.Submit(Click("run", 20));
            input.Submit(Pointer(30));
            input.Submit(Pointer(40));
            var events = input.Drain("run");

            Assert.That(events.Length, Is.EqualTo(3));
            Assert.That(events[0].X, Is.EqualTo(20));
            Assert.That(events[1].Kind, Is.EqualTo("pointerdown"));
            Assert.That(events[2].X, Is.EqualTo(40));
        }

        [Test]
        public void QueueAndBatchesAreBoundedAndResetAlwaysReleasesKeys()
        {
            var input = new InputController();
            input.BeginRun("run");

            for (int i = 0; i < 128; i++) input.Submit(Click("run", i));

            AssertStatus(429, () => input.Submit(Click("run", 0)));
            Assert.That(input.Drain("run").Length, Is.EqualTo(32));
            Assert.That(input.Count, Is.EqualTo(96));

            for (int i = 0; i < 32; i++) input.Submit(Click("run", i));

            input.Submit(new InputRequest { RunId = "run", Kind = "reset" });
            var reset = input.Drain("run");
            Assert.That(reset.Length, Is.EqualTo(1));
            Assert.That(reset[0].Kind, Is.EqualTo("reset"));
        }

        [Test]
        public void EndingAndReplacingRunsRejectsOldInputsAndRemovesQueuedEvents()
        {
            var input = new InputController();
            AssertStatus(409, () => input.Submit(Click("first", 0)));
            input.BeginRun("first");
            input.Submit(Click("first", 0));
            input.EndRun();
            AssertStatus(409, () => input.Drain("first"));
            input.BeginRun("second");
            Assert.That(input.Drain("second"), Is.Empty);
            AssertStatus(409, () => input.Submit(Click("first", 0)));
        }

        [TestCase(double.NaN, 0)]
        [TestCase(double.PositiveInfinity, 0)]
        [TestCase(401, 0)]
        [TestCase(-401, 0)]
        [TestCase(0, 301)]
        [TestCase(0, -301)]
        public void InvalidCoordinatesNeverEnterTheQueue(double x, double y)
        {
            var input = new InputController();
            input.BeginRun("run");
            var click = Click("run", x);
            click.Y = y;
            AssertStatus(400, () => input.Submit(click));
            Assert.That(input.Count, Is.Zero);
        }

        [TestCase("pointerdown", "", "")]
        [TestCase("pointerdown", "왼쪽", "a")]
        [TestCase("pointerdown", "오른쪽", "")]
        [TestCase("pointerup", "가운데", "")]
        [TestCase("click", "왼쪽", "")]
        [TestCase("keydown", "왼쪽", "a")]
        [TestCase("keyup", "", "ArrowLeft")]
        [TestCase("keydown", "", "A")]
        [TestCase("pointermove", "왼쪽", "")]
        [TestCase("reset", "", "a")]
        [TestCase("unknown", "", "")]
        public void InvalidInputShapesAreRejected(string kind, string button, string key)
        {
            var input = new InputController();
            input.BeginRun("run");
            AssertStatus(400, () => input.Submit(new InputRequest
            {
                RunId = "run", Kind = kind, Button = button, Key = key
            }));
            Assert.That(input.Count, Is.Zero);
        }

        [Test]
        public async Task SourceBytesStayFixedUntilRestartAndOldRequestsAreRejected()
        {
            var directory = Path.Combine(Path.GetTempPath(), "BlackPyInputTests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            await File.WriteAllTextAsync(Path.Combine(directory, "project.json"),
                "{\"background\":{\"file\":\"배경.py\"},\"actors\":[]}");
            var filename = Path.Combine(directory, "배경.py");
            var firstSource = Encoding.UTF8.GetBytes("# 한국어\nimport time\ntime.sleep(60)\n");
            var secondSource = Encoding.UTF8.GetBytes("# 새 코드\nimport time\ntime.sleep(60)\n");
            await File.WriteAllBytesAsync(filename, firstSource);

            try
            {
                var python = ProjectTestDirectory.PassivePython(await PythonCommand.ResolveAsync());
                await using var session = new RuntimeSession(directory, python, "http://127.0.0.1:1", "test-token");
                await session.ConnectAsync();
                var first = await session.RunAsync();
                await File.WriteAllBytesAsync(filename, secondSource);
                await File.WriteAllTextAsync(Path.Combine(directory, "project.json"),
                    "{\"background\":{\"file\":\"배경.py\",\"kind\":\"city\"},\"actors\":[]}");
                Assert.That((await session.GetProjectAsync()).Background.Kind, Is.EqualTo("plain"));
                var source = await session.GetSourceAsync(first.RunId!);
                Assert.That(Convert.FromBase64String(source.Sources[0].Source), Is.EqualTo(firstSource));
                Assert.That(source.Sources[0].Filename, Is.EqualTo(filename));
                await session.InputAsync(Click(first.RunId!, 10));
                Assert.That((await session.GetEventsAsync(first.RunId!))[0].X, Is.EqualTo(10));
                var secondBrowser = await session.ConnectAsync();
                await session.InputAsync(new InputRequest
                {
                    RunId = first.RunId!, Kind = "keydown", Key = "오른쪽"
                });
                await session.DisconnectAsync(secondBrowser);
                var released = await session.GetEventsAsync(first.RunId!);
                Assert.That(released.Length, Is.EqualTo(1));
                Assert.That(released[0].Kind, Is.EqualTo("reset"));
                Assert.That((await session.GetStateAsync()).Status, Is.EqualTo("running"));

                var second = await session.RestartAsync();
                Assert.That(Convert.FromBase64String((await session.GetSourceAsync(second.RunId!)).Sources[0].Source),
                    Is.EqualTo(secondSource));
                Assert.That((await session.GetProjectAsync()).Background.Kind, Is.EqualTo("city"));
                Assert.That(await session.GetEventsAsync(second.RunId!), Is.Empty);
                var staleSource = Assert.ThrowsAsync<BlackPyException>(async () =>
                    await session.GetSourceAsync(first.RunId!));
                Assert.That(staleSource!.StatusCode, Is.EqualTo(409));
                var staleInput = Assert.ThrowsAsync<BlackPyException>(async () =>
                    await session.InputAsync(Click(first.RunId!, 10)));
                Assert.That(staleInput!.StatusCode, Is.EqualTo(409));
                await session.StopAsync();
                var stopped = Assert.ThrowsAsync<BlackPyException>(async () =>
                    await session.GetEventsAsync(second.RunId!));
                Assert.That(stopped!.StatusCode, Is.EqualTo(409));
            }
            finally
            {
                Directory.Delete(directory, true);
            }
        }

        private static InputRequest Click(string runId, double x) => new()
        {
            RunId = runId, Kind = "pointerdown", Button = "왼쪽", X = x
        };

        private static InputRequest Pointer(double x) => new()
        {
            RunId = "run", Kind = "pointermove", X = x
        };

        private static void AssertStatus(int status, TestDelegate action) =>
            Assert.That(Assert.Throws<BlackPyException>(action)!.StatusCode, Is.EqualTo(status));
    }
}
