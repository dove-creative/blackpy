using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BlackThunder.BlackPy
{
    public class ProjectDefinition
    {
        public BackgroundDefinition Background { get; set; } = null!;
        public ActorDefinition[] Actors { get; set; } = Array.Empty<ActorDefinition>();
    }

    public class BackgroundDefinition
    {
        public string File { get; set; } = "";
        public string Kind { get; set; } = "plain";
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Image { get; set; }
    }

    public class ActorDefinition
    {
        public string Name { get; set; } = "";
        public string File { get; set; } = "";
        public string Kind { get; set; } = "cat";
        public double X { get; set; }
        public double Y { get; set; }
        public double Heading { get; set; }
        public double Scale { get; set; } = 1;
        public double Speed { get; set; } = 1;
        public bool Visible { get; set; } = true;
        public string Physics { get; set; } = "충돌만";
        public bool Trigger { get; set; }
        public double Mass { get; set; } = 1;
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Image { get; set; }
    }

    public class ImageResource
    {
        public byte[] Bytes { get; }
        public string ContentType { get; }

        public ImageResource(byte[] bytes, string contentType)
        {
            Bytes = bytes;
            ContentType = contentType;
        }
    }

    public class ProjectSnapshot
    {
        public ProjectDefinition Project { get; }
        public SourceSnapshot[] Sources { get; }

        public ProjectSnapshot(ProjectDefinition project, SourceSnapshot[] sources)
        {
            Project = project;
            Sources = sources;
        }
    }

    public static class ProjectLoader
    {
        // Internal
        public const long MaxImageBytes = 5 * 1024 * 1024;
        private static readonly Dictionary<string, string> _imageTypes = new(StringComparer.OrdinalIgnoreCase)
        {
            [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg",
            [".gif"] = "image/gif", [".webp"] = "image/webp", [".svg"] = "image/svg+xml"
        };


        // Content --------------------
        public static ProjectDefinition ReadDefinition(string directory)
        {
            var filename = DefinitionPath(directory);

            ProjectDefinition? project;

            try
            {
                // Read the definition once so every script uses the same configuration.
                var source = System.IO.File.ReadAllText(filename);
                project = JsonSerializer.Deserialize<ProjectDefinition>(source, StateMessage.JsonOptions);
            }
            catch (JsonException)
            {
                throw Invalid("project.json의 형식을 확인해 주세요.");
            }
            catch (IOException)
            {
                throw Invalid("project.json을 읽지 못했습니다. 파일을 확인해 주세요.");
            }
            catch (UnauthorizedAccessException)
            {
                throw Invalid("project.json을 읽을 권한이 없습니다.");
            }

            Validate(project);
            ValidateImages(project!, Path.GetDirectoryName(filename)!);
            return project!;
        }

        /// <summary>Reads an image named by the project from the folder that holds project.json.</summary>
        public static ImageResource ReadImage(string directory, ProjectDefinition project, string image)
        {
            if (string.IsNullOrEmpty(image) || (project.Background.Image != image
                && Array.FindIndex(project.Actors, actor => actor.Image == image) < 0))
                throw new BlackPyException(404, "프로젝트 설정에 없는 이미지입니다.");

            var filename = ImagePath(Path.GetDirectoryName(DefinitionPath(directory))!, image);

            try
            {
                var bytes = System.IO.File.ReadAllBytes(filename);
                if (bytes.LongLength > MaxImageBytes) throw Invalid("이미지는 5MB 이하의 파일을 사용해 주세요: " + image);
                return new ImageResource(bytes, _imageTypes[Path.GetExtension(image)]);
            }
            catch (IOException)
            {
                throw Invalid("이미지 파일을 읽지 못했습니다: " + image);
            }
            catch (UnauthorizedAccessException)
            {
                throw Invalid("이미지 파일을 읽을 권한이 없습니다: " + image);
            }
        }

        private static string DefinitionPath(string directory)
        {
            var filename = Path.Combine(directory, "_blackpy", "project.json");
            if (!System.IO.File.Exists(filename)) filename = Path.Combine(directory, "project.json");
            if (!System.IO.File.Exists(filename))
                throw Invalid("project.json이 있는 새 실습 프로젝트를 열어 주세요. 이전 main.py 형식은 지원하지 않습니다.");
            return filename;
        }

        private static void ValidateImages(ProjectDefinition project, string imageDirectory)
        {
            if (project.Background.Image != null) ImagePath(imageDirectory, project.Background.Image);

            foreach (ActorDefinition actor in project.Actors)
                if (actor.Image != null) ImagePath(imageDirectory, actor.Image);
        }

        // Images are plain file names beside project.json, never paths that leave that folder.
        private static string ImagePath(string imageDirectory, string image)
        {
            if (string.IsNullOrWhiteSpace(image) || image.Length > 200 || image.StartsWith('.')
                || image.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
                || image.Contains('/') || image.Contains('\\') || Path.IsPathRooted(image)
                || !_imageTypes.ContainsKey(Path.GetExtension(image)))
                throw Invalid("이미지는 project.json과 같은 _blackpy 폴더에 둔 png·jpg·gif·webp·svg 파일 이름으로 지정해 주세요.");

            var filename = Path.Combine(imageDirectory, image);
            var info = new FileInfo(filename);
            if (!info.Exists) throw Invalid("이미지 파일을 찾지 못했습니다. _blackpy 폴더를 확인해 주세요: " + image);
            if ((info.Attributes & FileAttributes.ReparsePoint) != 0)
                throw Invalid("연결 파일 대신 _blackpy 폴더에 저장한 이미지를 사용해 주세요: " + image);
            if (info.Length > MaxImageBytes) throw Invalid("이미지는 5MB 이하의 파일을 사용해 주세요: " + image);
            return filename;
        }

        public static ProjectSnapshot ReadSnapshot(string directory)
        {
            var project = ReadDefinition(directory);
            var sources = new SourceSnapshot[project.Actors.Length + 1];
            sources[0] = ReadSource(directory, project.Background.File);

            for (int i = 0; i < project.Actors.Length; i++)
                sources[i + 1] = ReadSource(directory, project.Actors[i].File);

            return new ProjectSnapshot(project, sources);
        }

        private static void Validate(ProjectDefinition? project)
        {
            if (project?.Background == null) throw Invalid("배경 파일과 모양을 설정해 주세요.");
            if (!SceneController.IsBackgroundKind(project.Background.Kind))
                throw Invalid("준비된 배경 모양을 사용해 주세요.");
            if (project.Actors == null || project.Actors.Length > 64)
                throw Invalid("캐릭터 목록에는 최대 64개까지 넣을 수 있습니다.");

            var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var names = new HashSet<string>(StringComparer.Ordinal) { "배경" };
            ValidateFile(project.Background.File, files);

            foreach (ActorDefinition actor in project.Actors)
            {
                if (actor == null || string.IsNullOrWhiteSpace(actor.Name) || actor.Name.Length > 80)
                    throw Invalid("캐릭터 이름은 1자부터 80자까지 필요합니다.");
                if (!names.Add(actor.Name)) throw Invalid("배경과 캐릭터 이름은 서로 달라야 합니다.");
                ValidateFile(actor.File, files);
                if (!SceneController.IsActorKind(actor.Kind)) throw Invalid("준비된 캐릭터 모양을 사용해 주세요.");
                ValidateNumber(actor.X, -100000, 100000, "가로 위치");
                ValidateNumber(actor.Y, -100000, 100000, "세로 위치");
                ValidateNumber(actor.Heading, -1000000, 1000000, "방향");
                ValidateNumber(actor.Scale, 0.1, 5, "크기");
                ValidateNumber(actor.Mass, 0.001, 100000, "무게");
                if (actor.Physics != "없음" && actor.Physics != "충돌만" && actor.Physics != "물리")
                    throw Invalid("물리는 없음, 충돌만, 물리 중 하나로 설정해 주세요.");
                if (!double.IsFinite(actor.Speed) || actor.Speed <= 0)
                    throw Invalid("속도 배율에는 0보다 큰 유한한 숫자를 넣어 주세요.");
            }
        }

        private static void ValidateFile(string filename, HashSet<string> files)
        {
            if (string.IsNullOrWhiteSpace(filename) || filename.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
                || filename.Contains('/') || filename.Contains('\\') || Path.IsPathRooted(filename)
                || !string.Equals(Path.GetExtension(filename), ".py", StringComparison.OrdinalIgnoreCase)
                || filename.Length <= 3)
                throw Invalid("스크립트는 프로젝트 폴더 바로 아래의 .py 파일 이름으로 지정해 주세요.");
            if (!files.Add(filename)) throw Invalid("각 배경과 캐릭터에는 서로 다른 Python 파일이 필요합니다.");
        }

        private static SourceSnapshot ReadSource(string directory, string file)
        {
            var filename = Path.GetFullPath(Path.Combine(directory, file));

            try
            {
                if ((System.IO.File.GetAttributes(filename) & FileAttributes.ReparsePoint) != 0)
                    throw Invalid("연결 파일 대신 프로젝트 폴더에 저장한 Python 파일을 사용해 주세요: " + file);

                return new SourceSnapshot(System.IO.File.ReadAllBytes(filename), filename);
            }
            catch (IOException)
            {
                throw Invalid("Python 파일을 읽지 못했습니다: " + file);
            }
            catch (UnauthorizedAccessException)
            {
                throw Invalid("Python 파일을 읽을 권한이 없습니다: " + file);
            }
        }

        private static void ValidateNumber(double value, double minimum, double maximum, string label)
        {
            if (!double.IsFinite(value) || value < minimum || value > maximum)
                throw Invalid(label + "에 사용할 수 있는 범위의 숫자를 넣어 주세요.");
        }

        private static BlackPyException Invalid(string message) => new(400, message);
    }
}
