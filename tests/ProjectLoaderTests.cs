using System;
using System.IO;
using System.Text;
using System.Text.Json;
using BlackThunder.BlackPy;
using NUnit.Framework;

namespace BlackThunder.BlackPy.Tests
{
    [TestFixture]
    public class ProjectLoaderTests
    {
        [Test]
        public void SupportFolderConfigurationKeepsStudentSourcesAtProjectRoot()
        {
            using var project = new ProjectTestDirectory();
            var support = Path.Combine(project.Path, "_blackpy");
            Directory.CreateDirectory(support);
            File.Move(Path.Combine(project.Path, "project.json"), Path.Combine(support, "project.json"));
            File.WriteAllText(Path.Combine(project.Path, "project.json"), "invalid legacy configuration");
            var snapshot = ProjectLoader.ReadSnapshot(project.Path);
            Assert.That(snapshot.Sources[1].Filename, Is.EqualTo(Path.Combine(project.Path, "고양이.py")));
            Assert.That(snapshot.Project.Actors[0].Name, Is.EqualTo("고양이"));
        }

        [Test]
        public void SnapshotRetainsEverySourceAndDefinitionUntilReadAgain()
        {
            using var project = new ProjectTestDirectory();
            var original = Encoding.UTF8.GetBytes("# 한국어\ndef 시작():\n    앞으로(100)\n");
            File.WriteAllBytes(Path.Combine(project.Path, "고양이.py"), original);
            var first = ProjectLoader.ReadSnapshot(project.Path);
            File.WriteAllText(Path.Combine(project.Path, "고양이.py"), "# 바뀐 코드\n");
            project.Definition.Actors[0].X = 200;
            project.SaveDefinition();
            var second = ProjectLoader.ReadSnapshot(project.Path);

            Assert.That(first.Sources.Length, Is.EqualTo(2));
            Assert.That(first.Sources[0].Filename, Is.EqualTo(Path.Combine(project.Path, "배경.py")));
            Assert.That(Convert.FromBase64String(first.Sources[1].Source), Is.EqualTo(original));
            Assert.That(first.Project.Actors[0].X, Is.Zero);
            Assert.That(second.Project.Actors[0].X, Is.EqualTo(200));
            Assert.That(second.Sources[1].Source, Is.Not.EqualTo(first.Sources[1].Source));
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(first, StateMessage.JsonOptions));
            Assert.That(json.RootElement.GetProperty("sources").GetArrayLength(), Is.EqualTo(2));
            Assert.That(json.RootElement.GetProperty("project").GetProperty("actors")[0]
                .GetProperty("speed").GetDouble(), Is.EqualTo(1));
            Assert.That(json.RootElement.GetProperty("project").GetProperty("actors")[0]
                .TryGetProperty("image", out _), Is.False);
            Assert.That(json.RootElement.GetProperty("project").GetProperty("background")
                .TryGetProperty("image", out _), Is.False);
        }

        [Test]
        public void ImagesBesideTheSupportConfigurationAreValidatedAndRead()
        {
            using var project = new ProjectTestDirectory();
            var support = Path.Combine(project.Path, "_blackpy");
            Directory.CreateDirectory(support);
            var svg = Encoding.UTF8.GetBytes("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 6\"/>");
            File.WriteAllBytes(Path.Combine(support, "낚시터.svg"), svg);
            File.WriteAllBytes(Path.Combine(support, "로켓.PNG"), new byte[] { 137, 80, 78, 71 });
            File.WriteAllBytes(Path.Combine(support, "비밀.svg"), svg);
            project.Definition.Background.Image = "낚시터.svg";
            project.Definition.Actors[0].Image = "로켓.PNG";
            project.SaveDefinition();
            File.Move(Path.Combine(project.Path, "project.json"), Path.Combine(support, "project.json"));

            var definition = ProjectLoader.ReadSnapshot(project.Path).Project;
            var background = ProjectLoader.ReadImage(project.Path, definition, "낚시터.svg");
            var actor = ProjectLoader.ReadImage(project.Path, definition, "로켓.PNG");

            Assert.That(background.Bytes, Is.EqualTo(svg));
            Assert.That(background.ContentType, Is.EqualTo("image/svg+xml"));
            Assert.That(actor.ContentType, Is.EqualTo("image/png"));
            Assert.That(Assert.Throws<BlackPyException>(() =>
                ProjectLoader.ReadImage(project.Path, definition, "비밀.svg"))!.StatusCode, Is.EqualTo(404));
            Assert.That(Assert.Throws<BlackPyException>(() =>
                ProjectLoader.ReadImage(project.Path, definition, "project.json"))!.StatusCode, Is.EqualTo(404));
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(definition, StateMessage.JsonOptions));
            Assert.That(json.RootElement.GetProperty("background").GetProperty("image").GetString(),
                Is.EqualTo("낚시터.svg"));
        }

        [TestCase("../outside.svg")]
        [TestCase("sub/stage.svg")]
        [TestCase("sub\\stage.svg")]
        [TestCase("C:\\stage.svg")]
        [TestCase("stage.txt")]
        [TestCase("project.json")]
        [TestCase(".svg")]
        [TestCase("")]
        [TestCase("없는그림.svg")]
        public void ImagesMustBeExistingPictureFilesBesideProjectJson(string image)
        {
            using var project = new ProjectTestDirectory();
            File.WriteAllText(Path.Combine(project.Path, "stage.txt"), "not an image");
            project.Definition.Background.Image = image;
            project.SaveDefinition();
            var error = Assert.Throws<BlackPyException>(() => ProjectLoader.ReadDefinition(project.Path))!;
            Assert.That(error.StatusCode, Is.EqualTo(400));
            Assert.That(error.Message, Does.Contain("이미지"));
        }

        [TestCase("../outside.py")]
        [TestCase("sub/actor.py")]
        [TestCase("sub\\actor.py")]
        [TestCase("C:\\outside.py")]
        [TestCase("actor.txt")]
        [TestCase(".py")]
        public void OnlyTopLevelPythonFilenamesAreAccepted(string file)
        {
            using var project = new ProjectTestDirectory();
            project.Definition.Actors[0].File = file;
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadSnapshot(project.Path));
        }

        [Test]
        public void Utf8BomConfigurationAndSourceAreSupported()
        {
            using var project = new ProjectTestDirectory();
            var encoding = new UTF8Encoding(true);
            File.WriteAllText(Path.Combine(project.Path, "project.json"),
                JsonSerializer.Serialize(project.Definition, StateMessage.JsonOptions), encoding);
            File.WriteAllText(Path.Combine(project.Path, "고양이.py"), "# 한국어\n", encoding);
            var snapshot = ProjectLoader.ReadSnapshot(project.Path);
            Assert.That(snapshot.Project.Actors[0].Name, Is.EqualTo("고양이"));
            Assert.That(Convert.FromBase64String(snapshot.Sources[1].Source),
                Is.EqualTo(File.ReadAllBytes(Path.Combine(project.Path, "고양이.py"))));
        }

        [Test]
        public void DuplicateNamesAndCaseInsensitiveFilesAreRejected()
        {
            using var project = new ProjectTestDirectory();
            project.Definition.Actors = new[]
            {
                new ActorDefinition { Name = "고양이", File = "cat.py" },
                new ActorDefinition { Name = "자동차", File = "CAT.py", Kind = "car" }
            };
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            project.Definition.Actors[1].File = "car.py";
            project.Definition.Actors[1].Name = "고양이";
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            project.Definition.Actors[1].Name = "배경";
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
        }

        [Test]
        public void InvalidConfigurationAndMissingScriptsHaveActionableErrors()
        {
            using var project = new ProjectTestDirectory();
            File.Delete(Path.Combine(project.Path, "고양이.py"));
            Assert.That(Assert.Throws<BlackPyException>(() => ProjectLoader.ReadSnapshot(project.Path))!.Message,
                Does.Contain("고양이.py"));
            File.WriteAllText(Path.Combine(project.Path, "project.json"), "{");
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            File.WriteAllText(Path.Combine(project.Path, "project.json"), "null");
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            File.Delete(Path.Combine(project.Path, "project.json"));
            Assert.That(Assert.Throws<BlackPyException>(() => ProjectLoader.ReadDefinition(project.Path))!.Message,
                Does.Contain("이전 main.py"));
        }

        [TestCase(0)]
        [TestCase(-1)]
        public void NonPositiveSpeedIsRejected(double speed)
        {
            using var project = new ProjectTestDirectory();
            project.Definition.Actors[0].Speed = speed;
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
        }

        [Test]
        public void InvalidShapesAndOutOfRangeStateAreRejected()
        {
            using var project = new ProjectTestDirectory();
            project.Definition.Background.Kind = "unknown";
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            project.Definition.Background.Kind = "plain";
            project.Definition.Actors[0].Kind = "unknown";
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            project.Definition.Actors[0].Kind = "cat";
            project.Definition.Actors[0].Scale = 0;
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            project.Definition.Actors[0].Scale = 1;
            project.Definition.Actors[0].X = 100001;
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
        }

        private static void AssertStatus(int status, TestDelegate action) =>
            Assert.That(Assert.Throws<BlackPyException>(action)!.StatusCode, Is.EqualTo(status));
    }

    internal class ProjectTestDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(), "BlackPyProjectTests-" + Guid.NewGuid().ToString("N"));
        public ProjectDefinition Definition { get; } = new()
        {
            Background = new BackgroundDefinition { File = "배경.py" },
            Actors = new[] { new ActorDefinition { Name = "고양이", File = "고양이.py" } }
        };

        public ProjectTestDirectory()
        {
            Directory.CreateDirectory(Path);
            File.WriteAllText(System.IO.Path.Combine(Path, "배경.py"), "# 배경\n");
            File.WriteAllText(System.IO.Path.Combine(Path, "고양이.py"), "# 고양이\n");
            SaveDefinition();
        }

        public void SaveDefinition() => File.WriteAllText(
            System.IO.Path.Combine(Path, "project.json"), JsonSerializer.Serialize(Definition, StateMessage.JsonOptions));

        public void Dispose() => Directory.Delete(Path, true);

        public static PythonCommand PassivePython(PythonCommand python, string body = "import time; time.sleep(60)") =>
            new(python.Executable, "-c", "import sys; sys.stdin.buffer.read(1); sys.stdin.buffer.readline(); " + body);
    }
}
