using System;
using System.Collections.Generic;
using Box2D.NET;
using static Box2D.NET.B2Bodies;
using static Box2D.NET.B2Distances;
using static Box2D.NET.B2Geometries;
using static Box2D.NET.B2Manifolds;
using static Box2D.NET.B2MathFunction;
using static Box2D.NET.B2Shapes;
using static Box2D.NET.B2Types;
using static Box2D.NET.B2Worlds;

namespace BlackThunder.BlackPy
{
    /// <summary>Owns the session's Box2D world, advanced by Python's ordered commands and elapsed time.</summary>
    public class PhysicsController
    {
        // Internal
        private const double UnitsPerMeter = 100;
        private const double TimeStep = 1.0 / 120;
        private const float ContactTolerance = 0.0075f;
        private readonly Dictionary<string, Actor> _actors = new(StringComparer.Ordinal);
        private readonly List<Collider> _boundaries = new();
        private string? _runId;
        private int _actorCount;
        private B2WorldId _world;
        private double _remainder;

        private class Collider
        {
            public B2BodyId Body;
            public B2Polygon Polygon;
            public B2ShapeProxy Proxy;
        }

        private class Actor : Collider
        {
            public string Id = "";
            public string Mode = "충돌만";
            public bool Visible = true;
            public double Mass;
            public double Width;
            public double Height;
            public double X;
            public double Y;
            public B2ShapeId Shape;
            public bool Enabled => Visible && Mode != "없음";
        }


        // Content --------------------
        // Run lifetime
        public void BeginRun(string runId, int actorCount)
        {
            if (string.IsNullOrEmpty(runId) || actorCount < 0 || actorCount > 64)
                throw Invalid("물리 실행과 캐릭터 수를 확인해 주세요.");

            EndRun();
            var definition = b2DefaultWorldDef();
            definition.gravity = new B2Vec2(0, -9.8f);
            _world = b2CreateWorld(definition);
            _runId = runId;
            _actorCount = actorCount;
            AddBoundary(-4.5f, 0, 0.5f, 4);
            AddBoundary(4.5f, 0, 0.5f, 4);
            AddBoundary(0, -3.5f, 5, 0.5f);
            AddBoundary(0, 3.5f, 5, 0.5f);
        }

        public PhysicsStepResult Step(PhysicsStepRequest request)
        {
            if (_runId == null || request == null || request.RunId != _runId)
                throw new BlackPyException(409, "끝났거나 다른 실행의 물리 요청입니다.");

            Validate(request);
            foreach (PhysicsActorState state in request.Actors) Synchronize(state);
            foreach (PhysicsCommand command in request.Commands) Apply(command);

            _remainder += request.DeltaTime;

            while (_remainder + 1e-12 >= TimeStep)
            {
                b2World_Step(_world, (float)TimeStep, 4);
                _remainder -= TimeStep;
            }

            return Snapshot();
        }

        public void EndRun()
        {
            if (_runId != null) b2DestroyWorld(_world);
            _runId = null;
            _actorCount = 0;
            _remainder = 0;
            _actors.Clear();
            _boundaries.Clear();
        }

        // Bodies and configuration
        private void AddBoundary(float x, float y, float halfWidth, float halfHeight)
        {
            var definition = b2DefaultBodyDef();
            definition.position = new B2Vec2(x, y);
            var collider = new Collider { Body = b2CreateBody(_world, definition) };
            ConfigureGeometry(collider, halfWidth, halfHeight);
            var shape = b2DefaultShapeDef();
            b2CreatePolygonShape(collider.Body, shape, collider.Polygon);
            _boundaries.Add(collider);
        }

        private void Synchronize(PhysicsActorState state)
        {
            var created = !_actors.TryGetValue(state.Id, out var actor);

            if (created)
            {
                var definition = b2DefaultBodyDef();
                definition.type = B2BodyType.b2_kinematicBody;
                definition.position = Vector(state.X, state.Y);
                definition.motionLocks.angularZ = true;
                actor = new Actor
                {
                    Id = state.Id,
                    Body = b2CreateBody(_world, definition),
                    X = state.X,
                    Y = state.Y
                };

                _actors.Add(state.Id, actor);
            }

            var body = actor!.Body;
            var changedMode = actor.Mode != state.Mode;
            var changedVisibility = actor.Visible != state.Visible;
            var resized = actor.Width != state.Width || actor.Height != state.Height;

            if (!created && actor.Mode == "물리") ReadPosition(actor);
            if (!created && resized) b2DestroyShape(actor.Shape, false);

            if (created || resized)
            {
                ConfigureGeometry(actor, (float)(state.Width / 200), (float)(state.Height / 200));
                var shape = b2DefaultShapeDef();
                actor.Shape = b2CreatePolygonShape(body, shape, actor.Polygon);
                actor.Width = state.Width;
                actor.Height = state.Height;
            }

            if (created || changedMode)
            {
                b2Body_SetType(body, state.Mode == "물리"
                    ? B2BodyType.b2_dynamicBody : B2BodyType.b2_kinematicBody);
                b2Body_SetMotionLocks(body, new B2MotionLocks(false, false, true));
                b2Body_SetBullet(body, state.Mode == "물리");
            }

            if (created || changedMode || changedVisibility)
            {
                b2Body_SetLinearVelocity(body, b2Vec2_zero);
                b2Body_SetAngularVelocity(body, 0);
            }

            actor.Mode = state.Mode;
            actor.Visible = state.Visible;

            if (state.Mode == "물리" && (created || changedMode || resized || actor.Mass != state.Mass))
            {
                b2Body_SetMassData(body, new B2MassData((float)state.Mass, b2Vec2_zero, 0));
                SetPosition(actor, actor.X, actor.Y);
            }

            actor.Mass = state.Mass;
            if (actor.Enabled && !b2Body_IsEnabled(body)) b2Body_Enable(body);
            if (!actor.Enabled && b2Body_IsEnabled(body)) b2Body_Disable(body);
        }

        private static void ConfigureGeometry(Collider collider, float halfWidth, float halfHeight)
        {
            collider.Polygon = b2MakeBox(halfWidth, halfHeight);
            collider.Proxy = b2MakeProxy(new[]
            {
                new B2Vec2(-halfWidth, -halfHeight), new B2Vec2(halfWidth, -halfHeight),
                new B2Vec2(halfWidth, halfHeight), new B2Vec2(-halfWidth, halfHeight)
            }, 4, 0);
        }

        // Ordered commands
        private void Apply(PhysicsCommand command)
        {
            var actor = _actors[command.Id];

            switch (command.Kind)
            {
                case "move":
                    Move(actor, command.X, command.Y);
                    break;
                case "teleport":
                    SetPosition(actor, command.X, command.Y);
                    break;
                case "impulse":
                    if (actor.Mode == "물리" && actor.Enabled)
                        b2Body_ApplyLinearImpulseToCenter(
                            actor.Body,
                            new B2Vec2((float)command.X, (float)command.Y),
                            true);
                    break;
                case "stop":
                    b2Body_SetLinearVelocity(actor.Body, b2Vec2_zero);
                    b2Body_SetAngularVelocity(actor.Body, 0);
                    break;
                default:
                    var state = new PhysicsActorState
                    {
                        Id = actor.Id,
                        X = actor.X,
                        Y = actor.Y,
                        Width = actor.Width,
                        Height = actor.Height,
                        Mode = actor.Mode,
                        Mass = actor.Mass,
                        Visible = actor.Visible
                    };

                    ApplyConfiguration(state, command);
                    Synchronize(state);
                    break;
            }
        }

        private static void ApplyConfiguration(PhysicsActorState state, PhysicsCommand command)
        {
            switch (command.Kind)
            {
                case "mode":
                    state.Mode = command.Mode;
                    break;
                case "mass":
                    state.Mass = command.X;
                    break;
                case "visible":
                    if (command.X != 0 && command.X != 1)
                        throw Invalid("가시성은 0 또는 1이어야 합니다.");
                    state.Visible = command.X == 1;
                    break;
                case "resize":
                    state.Width = command.X;
                    state.Height = command.Y;
                    break;
            }
        }

        private void Move(Actor actor, double x, double y)
        {
            if (actor.Mode == "물리") ReadPosition(actor);
            var fraction = 1.0f;

            if (actor.Mode == "물리" && actor.Enabled && (x != 0 || y != 0))
            {
                var translation = Vector(x, y);
                foreach (Collider boundary in _boundaries)
                    fraction = Math.Min(fraction, CastFraction(actor, boundary, translation));

                foreach (Actor other in _actors.Values)
                {
                    if (other != actor && other.Enabled)
                        fraction = Math.Min(fraction, CastFraction(actor, other, translation));
                }
            }

            SetPosition(actor, actor.X + x * fraction, actor.Y + y * fraction);
        }

        private static float CastFraction(Actor actor, Collider obstacle, B2Vec2 translation)
        {
            var from = b2Body_GetTransform(obstacle.Body);
            var to = b2Body_GetTransform(actor.Body);
            var distance = Distance(obstacle, actor);

            if (distance.distance <= ContactTolerance)
            {
                var manifold = b2CollidePolygons(ref obstacle.Polygon, from, ref actor.Polygon, to);
                var normal = manifold.pointCount > 0 ? manifold.normal : distance.normal;

                // Existing contact must allow motion along or away from its surface.
                if (b2Dot(translation, normal) >= -1e-6f) return 1;
            }

            var input = new B2ShapeCastPairInput
            {
                proxyA = obstacle.Proxy,
                proxyB = actor.Proxy,
                transformA = from,
                transformB = to,
                translationB = translation,
                maxFraction = 1,
                canEncroach = true
            };

            var hit = b2ShapeCast(input);
            return hit.hit ? hit.fraction : 1;
        }

        private static void SetPosition(Actor actor, double x, double y)
        {
            if (actor.Mode == "물리")
            {
                x = Math.Clamp(x, -400 + actor.Width / 2, 400 - actor.Width / 2);
                y = Math.Clamp(y, -300 + actor.Height / 2, 300 - actor.Height / 2);
            }

            actor.X = x;
            actor.Y = y;
            b2Body_SetTransform(actor.Body, Vector(x, y), b2Rot_identity);
            if (actor.Enabled) b2Body_SetAwake(actor.Body, true);
        }

        // Results and contacts
        private PhysicsStepResult Snapshot()
        {
            var results = new PhysicsActorResult[_actorCount];

            for (int i = 0; i < results.Length; i++)
            {
                var actor = _actors["actor-" + (i + 1)];
                if (actor.Mode == "물리") ReadPosition(actor);
                results[i] = new PhysicsActorResult { Id = actor.Id, X = actor.X, Y = actor.Y };
            }

            var contacts = new List<string>[results.Length];
            for (int i = 0; i < contacts.Length; i++) contacts[i] = new List<string>();

            for (int i = 0; i < results.Length; i++)
            {
                var actor = _actors[results[i].Id];
                if (!actor.Enabled) continue;

                for (int j = i + 1; j < results.Length; j++)
                {
                    var other = _actors[results[j].Id];
                    if (!other.Enabled) continue;

                    if (Distance(actor, other).distance <= ContactTolerance)
                    {
                        contacts[i].Add(other.Id);
                        contacts[j].Add(actor.Id);
                    }
                }
            }

            for (int i = 0; i < results.Length; i++) results[i].Contacts = contacts[i].ToArray();
            return new PhysicsStepResult { Actors = results };
        }

        private static B2DistanceOutput Distance(Collider first, Collider second)
        {
            var input = new B2DistanceInput
            {
                proxyA = first.Proxy,
                proxyB = second.Proxy,
                transformA = b2Body_GetTransform(first.Body),
                transformB = b2Body_GetTransform(second.Body),
                useRadii = true
            };

            var cache = new B2SimplexCache();
            return b2ShapeDistance(ref input, ref cache, Span<B2Simplex>.Empty, 0);
        }

        private static void ReadPosition(Actor actor)
        {
            var position = b2Body_GetPosition(actor.Body);
            actor.X = position.X * UnitsPerMeter;
            actor.Y = position.Y * UnitsPerMeter;
        }

        private static B2Vec2 Vector(double x, double y) =>
            new((float)(x / UnitsPerMeter), (float)(y / UnitsPerMeter));

        // Validation
        internal void Validate(PhysicsStepRequest request)
        {
            ValidateNumber(request.DeltaTime, 0, 10, "프레임 시간");
            if (request.Actors == null || request.Actors.Length != _actorCount)
                throw Invalid("등록한 캐릭터 전체의 물리 상태가 필요합니다.");
            if (request.Commands == null || request.Commands.Length > 8192)
                throw Invalid("한 프레임의 물리 명령은 8192개 이하여야 합니다.");

            var expected = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 1; i <= _actorCount; i++) expected.Add("actor-" + i);
            var effective = new Dictionary<string, PhysicsActorState>(StringComparer.Ordinal);

            foreach (PhysicsActorState actor in request.Actors)
            {
                if (actor == null || actor.Id == null || !expected.Remove(actor.Id))
                    throw Invalid("물리 캐릭터 번호가 중복되거나 등록되어 있지 않습니다.");

                ValidateNumber(actor.X, -100000, 100000, "가로 위치");
                ValidateNumber(actor.Y, -100000, 100000, "세로 위치");
                ValidateConfiguration(actor);
                effective.Add(actor.Id, new PhysicsActorState
                {
                    Id = actor.Id,
                    Width = actor.Width,
                    Height = actor.Height,
                    Mode = actor.Mode,
                    Mass = actor.Mass,
                    Visible = actor.Visible
                });
            }

            foreach (PhysicsCommand command in request.Commands)
            {
                if (command == null || command.Id == null || !effective.TryGetValue(command.Id, out var state))
                    throw Invalid("등록한 캐릭터에만 물리 명령을 사용할 수 있습니다.");
                if (command.Kind != "move" && command.Kind != "teleport"
                    && command.Kind != "impulse" && command.Kind != "stop"
                    && command.Kind != "mode" && command.Kind != "mass"
                    && command.Kind != "visible" && command.Kind != "resize")
                    throw Invalid("물리 명령의 종류를 확인해 주세요.");

                ValidateNumber(command.X, -100000, 100000, "가로 값");
                ValidateNumber(command.Y, -100000, 100000, "세로 값");
                ApplyConfiguration(state, command);
                ValidateConfiguration(state);
            }
        }

        private static void ValidateConfiguration(PhysicsActorState actor)
        {
            ValidateNumber(actor.Width, 1, 2000, "가로 크기");
            ValidateNumber(actor.Height, 1, 2000, "세로 크기");
            ValidateNumber(actor.Mass, 0.001, 100000, "무게");
            if (actor.Mode != "없음" && actor.Mode != "충돌만" && actor.Mode != "물리")
                throw Invalid("물리 설정은 없음, 충돌만, 물리 중 하나여야 합니다.");
            if (actor.Mode == "물리" && (actor.Width > 800 || actor.Height > 600))
                throw Invalid("물리 객체의 크기는 무대 안에 들어갈 수 있어야 합니다.");
        }

        private static void ValidateNumber(double value, double minimum, double maximum, string label)
        {
            if (!double.IsFinite(value) || value < minimum || value > maximum)
                throw Invalid(label + "에 사용할 수 있는 범위의 숫자를 넣어 주세요.");
        }

        private static BlackPyException Invalid(string message) => new(400, message);
    }
}
