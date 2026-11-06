using System;
using System.Numerics;
using System.Threading.Tasks;
using BlackThunder.UniEngine.Core;
using BlackThunder.UniEngine.Core.Utilities;
using BlackThunder.UniEngine.Infrastructure.Objects;

namespace BlackThunder.BlackPy
{
    /// <summary>Owns one character's motion. All calls belong to the simulation thread.</summary>
    public class MotionController : IDisposable, IObserver<float>
    {
        // Front
        public const double MovementSpeed = 200;
        public const double RotationSpeed = 180;
        public Transform2D Transform { get; private set; } = Transform2D.Identity;
        public bool IsMoving => _motion != null;
        public double Heading => NormalizeDegrees(Transform.Rotation * 180.0 / Math.PI);

        // Internal
        private readonly Loco _loco = new();
        private readonly EventStream<Transform2D> _changed = new();
        private readonly IDisposable _tickConnection;
        private Motion? _motion;


        // Content
        public MotionController() => _tickConnection = _loco.Subscribe(this);

        public IDisposable Subscribe(Action<Transform2D> changed) => _changed.Subscribe(changed);

        public Task Command(string command, double[] args)
        {
            if (IsMoving) throw new InvalidOperationException("이미 이동 중입니다.");
            Validate(command, args);

            var start = Transform.Position;
            var targetX = (double)start.X;
            var targetY = (double)start.Y;
            var angle = 0.0;
            var rotating = command == "left" || command == "right";

            switch (command)
            {
                case "forward":
                case "backward":
                    var distance = args[0] * (command == "backward" ? -1 : 1);
                    targetX += Math.Cos(Transform.Rotation) * distance;
                    targetY += Math.Sin(Transform.Rotation) * distance;
                    break;
                case "goto":
                    targetX = args[0];
                    targetY = args[1];
                    break;
                case "left":
                case "right":
                    angle = args[0] * (command == "right" ? -1 : 1);
                    break;
            }

            if (!FitsCoordinate(targetX) || !FitsCoordinate(targetY))
                throw new ArgumentOutOfRangeException(nameof(args), "좌표가 표현할 수 있는 범위를 벗어났습니다.");

            var dx = targetX - start.X;
            var dy = targetY - start.Y;
            var duration = rotating
                ? Math.Abs(angle) / RotationSpeed
                : Math.Sqrt(dx * dx + dy * dy) / MovementSpeed;
            var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

            _motion = new Motion(
                start, new Vector2((float)targetX, (float)targetY), Heading,
                angle, rotating, duration, completion);

            if (duration == 0) OnNext(0);

            return completion.Task;
        }

        public static void Validate(string command, double[] args)
        {
            if (args == null) throw new ArgumentException("명령의 숫자가 필요합니다.");
            var expected = command switch
            {
                "forward" or "backward" or "left" or "right" => 1,
                "goto" => 2,
                _ => throw new ArgumentException("지원하지 않는 캐릭터 명령입니다.")
            };

            if (args.Length != expected)
                throw new ArgumentException("명령에 필요한 숫자의 개수가 맞지 않습니다.");

            foreach (var value in args)
            {
                if (!FitsCoordinate(value))
                    throw new ArgumentOutOfRangeException(nameof(args), "유한한 범위의 숫자를 입력해 주세요.");
            }
        }

        public void Tick(float deltaTime) => _loco.Tick(LocoTiming.Update, deltaTime);

        public void Reset()
        {
            Cancel();
            Transform = Transform2D.Identity;
            _changed.OnNext(Transform);
        }

        public void Cancel()
        {
            var previous = _motion;
            _motion = null;
            previous?.Completion.TrySetCanceled();
        }

        public void OnNext(float deltaTime)
        {
            var motion = _motion;
            if (motion == null) return;

            motion.Elapsed += deltaTime;
            var progress = motion.Duration == 0 ? 1 : Math.Min(1, motion.Elapsed / motion.Duration);

            if (motion.Rotating)
            {
                var heading = NormalizeDegrees(motion.StartHeading + motion.Angle * progress);
                Transform = new Transform2D(Transform.Position, (float)(heading * Math.PI / 180));
            }
            else
            {
                var x = motion.Start.X + ((double)motion.Target.X - motion.Start.X) * progress;
                var y = motion.Start.Y + ((double)motion.Target.Y - motion.Start.Y) * progress;
                Transform = Transform.MoveTo(new Vector2((float)x, (float)y));
            }

            _changed.OnNext(Transform);

            if (progress >= 1)
            {
                _motion = null;
                motion.Completion.TrySetResult(true);
            }
        }

        public void OnCompleted() => Cancel();
        public void OnError(Exception error) => Cancel();

        public void Dispose()
        {
            Cancel();
            _tickConnection.Dispose();
            _loco.Dispose();
            _changed.Dispose();
        }

        private static bool FitsCoordinate(double value) =>
            double.IsFinite(value) && Math.Abs(value) <= float.MaxValue;

        private static double NormalizeDegrees(double angle)
        {
            var value = angle % 360;
            if (value < 0) value += 360;
            return Math.Abs(value - 360) < 0.0001 || Math.Abs(value) < 0.0001 ? 0 : value;
        }

        private class Motion
        {
            public Vector2 Start { get; }
            public Vector2 Target { get; }
            public double StartHeading { get; }
            public double Angle { get; }
            public bool Rotating { get; }
            public double Duration { get; }
            public double Elapsed { get; set; }
            public TaskCompletionSource<bool> Completion { get; }

            public Motion(
                Vector2 start, Vector2 target, double startHeading, double angle, bool rotating,
                double duration, TaskCompletionSource<bool> completion)
            {
                Start = start;
                Target = target;
                StartHeading = startHeading;
                Angle = angle;
                Rotating = rotating;
                Duration = duration;
                Completion = completion;
            }
        }
    }
}
