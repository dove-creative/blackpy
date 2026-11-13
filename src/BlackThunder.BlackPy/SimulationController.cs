using System;
using System.Collections.Generic;
using System.Linq;

namespace BlackThunder.BlackPy
{
    /// <summary>Owns actor motion, input leases, and physics on the session's independent clock.</summary>
    public class SimulationController
    {
        // Property
        public bool Initialized { get; private set; }
        public bool Ready { get; private set; }
        public long TickNumber { get; private set; }
        public double Elapsed { get; private set; }

        // Internal
        private const int HistoryLimit = 8192;
        private readonly PhysicsController _physics = new();
        private readonly Dictionary<string, Actor> _actors = new(StringComparer.Ordinal);
        private readonly List<Motion> _motions = new();
        private readonly Dictionary<(string, string), Rate> _rates = new();
        private readonly Dictionary<string, long> _keys = new(StringComparer.Ordinal);
        private readonly List<string> _completed = new();
        private readonly List<SimulationContactEvent> _contacts = new();
        private string? _runId;
        private int _actorCount;
        private long _sequence;
        private long _generation;
        private long _contactSequence;
        private string? _pointerId;
        private long _pointerGeneration;
        private SceneState _appearance = new();

        private class Actor
        {
            public PhysicsActorState State = new();
            public double Heading;
            public long ContactGeneration;
            public string[] Contacts = Array.Empty<string>();
        }

        private class Motion
        {
            public SimulationCommand Command = new();
            public double Elapsed;
        }

        private class Rate
        {
            public SimulationCommand Command = new();
        }


        // Content --------------------
        // Run lifetime and exchange
        public void BeginRun(string runId, int actorCount)
        {
            EndRun();
            _physics.BeginRun(runId, actorCount);
            _runId = runId;
            _actorCount = actorCount;
        }

        public void EndRun()
        {
            _physics.EndRun();
            _runId = null;
            _actorCount = 0;
            _sequence = 0;
            _generation = 0;
            _contactSequence = 0;
            _pointerId = null;
            _pointerGeneration = 0;
            _actors.Clear();
            _motions.Clear();
            _rates.Clear();
            _keys.Clear();
            _completed.Clear();
            _contacts.Clear();
            _appearance = new SceneState();
            Initialized = false;
            Ready = false;
            TickNumber = 0;
            Elapsed = 0;
        }

        public SimulationExchangeResult Exchange(SimulationExchangeRequest request)
        {
            RequireRun(request.RunId);
            if (request.Sequence < 1 || request.Sequence > _sequence + 1)
                throw Invalid("실행 명령의 순서 번호를 확인해 주세요.");
            if (request.Sequence <= _sequence) return Snapshot();

            var appearance = ValidateAppearance(request.Scene);
            var states = Initialized ? States() : CopyInitialActors(request.Actors);
            if (!Initialized)
                foreach (var state in states)
                    state.Heading = appearance.Sprites.Single(sprite => sprite.Id == state.Id).Heading;
            var commands = ValidateCommands(request, states);
            var physics = new PhysicsStepRequest
            {
                RunId = request.RunId, Actors = states, Commands = commands
            };
            _physics.Validate(physics);

            if (!Initialized)
            {
                for (int i = 1; i <= _actorCount; i++)
                {
                    var state = states.Single(value => value.Id == "actor-" + i);
                    var sprite = appearance.Sprites.Single(value => value.Id == state.Id);
                    _actors.Add(state.Id, new Actor { State = state, Heading = sprite.Heading });
                }
                Initialized = true;
            }

            _appearance = appearance;
            foreach (string token in request.AcknowledgedCompletions) _completed.Remove(token);
            _contacts.RemoveAll(contact => contact.Sequence <= request.ContactAck);
            var result = _physics.Step(physics);

            foreach (SimulationCommand command in request.Commands)
            {
                var actor = _actors[command.Id];
                switch (command.Kind)
                {
                    case "motion":
                        if (command.Duration == 0)
                        {
                            Complete(command.Token);
                        }
                        else _motions.Add(new Motion { Command = Copy(command) });
                        break;
                    case "rate":
                        SetRate(command);
                        break;
                    case "mode":
                        actor.State.Mode = command.Mode;
                        actor.State.Trigger = command.Trigger;
                        break;
                    case "mass":
                        actor.State.Mass = command.X;
                        break;
                    case "visible":
                        actor.State.Visible = command.X == 1;
                        break;
                    case "resize":
                        actor.State.Width = command.X;
                        actor.State.Height = command.Y;
                        break;
                }
            }

            UpdatePhysics(result);
            Ready |= request.Ready;
            _sequence = request.Sequence;
            return Snapshot();
        }

        public void SetAppearance(SceneState scene)
        {
            if (!Initialized) throw Invalid("캐릭터의 초기 상태가 아직 준비되지 않았습니다.");
            _appearance = ValidateAppearance(scene);
        }

        // Independent clock
        public void Tick(double deltaTime)
        {
            if (!Ready) return;
            Number(deltaTime, 0, double.MaxValue, "진행 시간");
            var remaining = Math.Min(deltaTime, 0.1);
            while (remaining > 1e-12)
            {
                var step = Math.Min(remaining, 1.0 / 120);
                Advance(step);
                remaining -= step;
            }
            TickNumber++;
        }

        private void Advance(double delta)
        {
            var changes = new Dictionary<string, (double X, double Y, double Heading, double Forward)>(StringComparer.Ordinal);
            foreach (string id in _actors.Keys) changes.Add(id, (0, 0, 0, 0));
            var finished = new List<Motion>();

            foreach (Motion motion in _motions)
            {
                var command = motion.Command;
                var remaining = command.Duration - motion.Elapsed;
                var step = Math.Min(delta, remaining);
                motion.Elapsed += step;
                AddChange(command, step / command.Duration);
                if (motion.Elapsed + 1e-12 >= command.Duration) finished.Add(motion);
            }

            foreach (Rate rate in _rates.Values) AddChange(rate.Command, delta);
            var commands = new List<PhysicsCommand>();
            foreach (var entry in changes)
            {
                var change = entry.Value;
                if (change.X != 0 || change.Y != 0 || change.Heading != 0 || change.Forward != 0)
                    commands.Add(new PhysicsCommand
                    {
                        Id = entry.Key, Kind = "move", X = change.X, Y = change.Y,
                        Rotation = change.Heading, Forward = change.Forward
                    });
            }

            var result = _physics.Step(new PhysicsStepRequest
            {
                RunId = _runId!, DeltaTime = delta, Actors = States(), Commands = commands.ToArray()
            });
            UpdatePhysics(result);
            foreach (Motion motion in finished)
            {
                _motions.Remove(motion);
                Complete(motion.Command.Token);
            }
            Elapsed += delta;

            void AddChange(SimulationCommand command, double factor)
            {
                var old = changes[command.Id];
                changes[command.Id] = (old.X + command.X * factor, old.Y + command.Y * factor,
                    old.Heading + command.Rotation * factor, old.Forward + command.Forward * factor);
            }
        }

        // Input ownership
        public void Accept(InputEvent input)
        {
            switch (input.Kind)
            {
                case "keydown":
                    if (!_keys.ContainsKey(input.Key)) _keys.Add(input.Key, ++_generation);
                    input.Generation = _keys[input.Key];
                    break;
                case "keyup":
                    _keys.TryGetValue(input.Key, out var generation);
                    input.Generation = generation;
                    _keys.Remove(input.Key);
                    RemoveRates("key:" + input.Key);
                    break;
                case "pointerdown":
                    if (_pointerId == null)
                    {
                        _pointerId = Hit(input.X, input.Y);
                        _pointerGeneration = ++_generation;
                    }
                    input.TargetId = _pointerId;
                    input.Generation = _pointerGeneration;
                    break;
                case "pointerup":
                    input.TargetId = _pointerId;
                    input.Generation = _pointerGeneration;
                    _pointerId = null;
                    RemoveRates("pointer");
                    break;
                case "reset":
                    _keys.Clear();
                    _pointerId = null;
                    _pointerGeneration = ++_generation;
                    foreach (var key in _rates.Keys.Where(key => key.Item2 == "pointer"
                        || key.Item2.StartsWith("key:", StringComparison.Ordinal)).ToArray()) _rates.Remove(key);
                    input.Generation = _generation;
                    break;
            }
        }

        private string Hit(double x, double y)
        {
            for (int i = _appearance.Sprites.Length - 1; i >= 0; i--)
            {
                var id = _appearance.Sprites[i].Id;
                if (!_actors.TryGetValue(id, out var actor)) continue;
                var state = actor.State;
                if (state.Visible && Math.Abs(state.X - x) <= state.Width / 2
                    && Math.Abs(state.Y - y) <= state.Height / 2) return id;
            }
            return "background";
        }

        private void SetRate(SimulationCommand command)
        {
            if (!IsActive(command)) return;
            var key = (command.Id, command.Source);
            if (_rates.TryGetValue(key, out var previous) && previous.Command.Generation == command.Generation
                && previous.Command.Revision > command.Revision) return;
            _rates[key] = new Rate { Command = Copy(command) };
        }

        private bool IsActive(SimulationCommand command)
        {
            if (command.Source.StartsWith("key:", StringComparison.Ordinal))
                return _keys.TryGetValue(command.Source.Substring(4), out var generation)
                    && generation == command.Generation;
            if (command.Source == "pointer")
                return _pointerId != null && _pointerGeneration == command.Generation;
            var id = command.Source.Substring(8);
            return _actors.TryGetValue(id, out var actor) && actor.Contacts.Length != 0
                && actor.ContactGeneration == command.Generation;
        }

        private void RemoveRates(string source)
        {
            foreach (var key in _rates.Keys.Where(key => key.Item2 == source).ToArray()) _rates.Remove(key);
        }

        // Results
        public SimulationExchangeResult Snapshot() => new()
        {
            Tick = TickNumber,
            Elapsed = Elapsed,
            Actors = _actors.Values.Select(actor => new SimulationActorResult
            {
                Id = actor.State.Id, X = actor.State.X, Y = actor.State.Y, Heading = actor.Heading,
                Contacts = actor.Contacts.ToArray(), ContactGeneration = actor.ContactGeneration
            }).ToArray(),
            Completed = _completed.ToArray(),
            Contacts = _contacts.Select(contact => new SimulationContactEvent
            {
                Sequence = contact.Sequence, Id = contact.Id, Kind = contact.Kind, Others = contact.Others.ToArray()
            }).ToArray(),
            Keys = new Dictionary<string, long>(_keys, StringComparer.Ordinal),
            PointerId = _pointerId,
            PointerGeneration = _pointerGeneration
        };

        public SceneState Scene()
        {
            return new SceneState
            {
                Active = Initialized,
                Background = _appearance.Background,
                Message = _appearance.Message,
                TextInput = _appearance.TextInput,
                Sprites = _appearance.Sprites.Select(sprite =>
                {
                    var actor = _actors[sprite.Id];
                    var state = actor.State;
                    return new SpriteState
                    {
                        Id = sprite.Id, Kind = sprite.Kind, X = state.X, Y = state.Y,
                        Width = state.Width, Height = state.Height, Heading = actor.Heading,
                        FlipHorizontal = sprite.FlipHorizontal, FlipVertical = sprite.FlipVertical,
                        Visible = state.Visible, Color = sprite.Color, Label = sprite.Label, Speech = sprite.Speech
                    };
                }).ToArray()
            };
        }

        private void UpdatePhysics(PhysicsStepResult result)
        {
            foreach (PhysicsActorResult state in result.Actors)
            {
                var actor = _actors[state.Id];
                actor.State.X = state.X;
                actor.State.Y = state.Y;
                actor.State.Heading = state.Heading;
                actor.Heading = state.Heading;
                if (actor.Contacts.SequenceEqual(state.Contacts)) continue;
                var exited = actor.Contacts.Except(state.Contacts).ToArray();
                var entered = state.Contacts.Except(actor.Contacts).ToArray();
                actor.Contacts = state.Contacts.ToArray();
                actor.ContactGeneration++;
                RemoveRates("contact:" + state.Id);
                AddContact(state.Id, "exit", exited);
                AddContact(state.Id, "enter", entered);
            }
        }

        private void AddContact(string id, string kind, string[] others)
        {
            if (others.Length == 0) return;
            if (_contacts.Count >= HistoryLimit) throw Invalid("접촉 이벤트가 너무 많이 쌓였습니다.");
            _contacts.Add(new SimulationContactEvent
            {
                Sequence = ++_contactSequence, Id = id, Kind = kind, Others = others
            });
        }

        private void Complete(string token)
        {
            if (_completed.Count >= HistoryLimit) throw Invalid("완료된 이동 결과가 너무 많이 쌓였습니다.");
            _completed.Add(token);
        }

        // Validation and copies
        private SceneState ValidateAppearance(SceneState scene)
        {
            var copy = SceneController.CopyValidated(scene);
            if (copy.Sprites.Length != _actorCount) throw Invalid("등록한 캐릭터 전체의 장면이 필요합니다.");
            var ids = new HashSet<string>(copy.Sprites.Select(sprite => sprite.Id), StringComparer.Ordinal);
            for (int i = 1; i <= _actorCount; i++)
                if (!ids.Contains("actor-" + i)) throw Invalid("장면의 캐릭터 번호를 확인해 주세요.");
            return copy;
        }

        private PhysicsActorState[] CopyInitialActors(PhysicsActorState[] states)
        {
            if (states == null || states.Length != _actorCount || states.Any(state => state == null))
                throw Invalid("등록한 캐릭터 전체의 초기 상태가 필요합니다.");
            return states.Select(Copy).ToArray();
        }

        private PhysicsCommand[] ValidateCommands(SimulationExchangeRequest request, PhysicsActorState[] states)
        {
            if (request.Commands == null || request.Commands.Length > HistoryLimit)
                throw Invalid("한 번의 실행 명령은 8192개 이하여야 합니다.");
            if (request.AcknowledgedCompletions == null || request.AcknowledgedCompletions.Length > HistoryLimit
                || request.AcknowledgedCompletions.Any(token => token == null))
                throw Invalid("완료된 이동 확인 목록을 확인해 주세요.");
            if (request.ContactAck < 0 || request.ContactAck > _contactSequence)
                throw Invalid("접촉 이벤트 확인 번호를 확인해 주세요.");

            var ids = new HashSet<string>(states.Select(state => state.Id), StringComparer.Ordinal);
            var tokens = new HashSet<string>(_motions.Select(motion => motion.Command.Token), StringComparer.Ordinal);
            tokens.UnionWith(_completed.Except(request.AcknowledgedCompletions));
            var physics = new List<PhysicsCommand>();

            foreach (SimulationCommand command in request.Commands)
            {
                if (command == null || command.Id == null || !ids.Contains(command.Id))
                    throw Invalid("등록한 캐릭터에만 실행 명령을 사용할 수 있습니다.");
                var maximum = command.Kind == "rate" ? double.MaxValue : command.Kind == "heading" ? 1000000 : 100000;
                Number(command.X, -maximum, maximum, "가로 값");
                Number(command.Y, command.Kind == "rate" ? -double.MaxValue : -100000,
                    command.Kind == "rate" ? double.MaxValue : 100000, "세로 값");
                Number(command.Rotation, command.Kind == "rate" ? -double.MaxValue : -1000000,
                    command.Kind == "rate" ? double.MaxValue : 1000000, "회전 값");
                Number(command.Forward, -double.MaxValue, double.MaxValue, "앞으로 값");
                if (command.Kind == "motion")
                {
                    if (!Ready && !request.Ready) throw Invalid("이동은 시작 또는 이벤트 함수 안에서 사용해 주세요.");
                    Number(command.Duration, 0, double.MaxValue, "이동 시간");
                    if (string.IsNullOrWhiteSpace(command.Token) || command.Token.Length > 128 || !tokens.Add(command.Token))
                        throw Invalid("이동 완료 번호가 중복되거나 올바르지 않습니다.");
                    if (tokens.Count > HistoryLimit) throw Invalid("기다리는 이동 명령이 너무 많습니다.");
                    if (command.Duration == 0)
                        physics.Add(new PhysicsCommand
                            { Id = command.Id, Kind = "move", X = command.X, Y = command.Y, Rotation = command.Rotation });
                }
                else if (command.Kind == "rate")
                {
                    if (command.Source == null || command.Source.Length > 100 || command.Generation < 0
                        || command.Revision < 0 || !(command.Source.StartsWith("key:", StringComparison.Ordinal)
                            || command.Source == "pointer" || command.Source.StartsWith("contact:", StringComparison.Ordinal)))
                        throw Invalid("유지 이동의 입력과 순서 번호를 확인해 주세요.");
                }
                else physics.Add(command);
            }
            return physics.ToArray();
        }

        private PhysicsActorState[] States() => _actors.Values.Select(actor => Copy(actor.State)).ToArray();

        private static PhysicsActorState Copy(PhysicsActorState actor) => new()
        {
            Id = actor.Id, X = actor.X, Y = actor.Y, Width = actor.Width, Height = actor.Height,
            Mode = actor.Mode, Mass = actor.Mass, Visible = actor.Visible,
            Heading = actor.Heading, Trigger = actor.Trigger
        };

        private static SimulationCommand Copy(SimulationCommand command) => new()
        {
            Id = command.Id, Kind = command.Kind, X = command.X, Y = command.Y, Mode = command.Mode,
            Token = command.Token, Duration = command.Duration, Rotation = command.Rotation,
            Forward = command.Forward, Trigger = command.Trigger,
            Source = command.Source, Generation = command.Generation, Revision = command.Revision
        };

        private void RequireRun(string runId)
        {
            if (_runId == null || runId != _runId) throw new BlackPyException(409, "끝났거나 다른 실행의 명령입니다.");
        }

        private static double Normalize(double heading) => (heading % 360 + 360) % 360;

        private static void Number(double value, double minimum, double maximum, string label)
        {
            if (!double.IsFinite(value) || value < minimum || value > maximum)
                throw Invalid(label + "에 사용할 수 있는 범위의 숫자를 넣어 주세요.");
        }

        private static BlackPyException Invalid(string message) => new(400, message);
    }
}
