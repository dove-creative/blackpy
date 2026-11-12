using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace BlackThunder.BlackPy
{
    public static class Program
    {
        public static async Task<int> Main(string[] args)
        {
            try { return await RunAsync(Options.Parse(args)); }
            catch (Exception exception)
            {
                Console.Error.WriteLine(exception.Message);
                if (OperatingSystem.IsWindows() && !args.Contains("--no-browser") && GetConsoleWindow() == IntPtr.Zero)
                    MessageBox(IntPtr.Zero, exception.Message, "BlackPy를 시작하지 못했어요", 0x10);
                return 1;
            }
        }

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetConsoleWindow();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int MessageBox(IntPtr owner, string text, string caption, uint type);

        private static async Task<int> RunAsync(Options options)
        {
            var python = await PythonCommand.ResolveAsync();
            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                Args = Array.Empty<string>(),
                ContentRootPath = AppContext.BaseDirectory,
                WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")
            });
            builder.Logging.ClearProviders();
            builder.WebHost.ConfigureKestrel(server =>
            {
                server.Listen(IPAddress.Loopback, options.Port);
                server.Limits.MaxRequestBodySize = 262144;
            });

            await using var app = builder.Build();
            RuntimeSession? session = null;
            var baseUrl = "";
            app.Use(async (context, next) =>
            {
                try
                {
                    if (baseUrl.Length == 0)
                        throw new BlackPyException(503, "실행 프로그램을 준비하고 있습니다.");

                    var authority = new Uri(baseUrl).Authority;
                    if (!string.Equals(context.Request.Host.Value, authority, StringComparison.OrdinalIgnoreCase))
                        throw new BlackPyException(403, "로컬 실행 주소로 접속해 주세요.");

                    var isApi = context.Request.Path.StartsWithSegments("/api");
                    var isSocket = context.Request.Path == "/ws";

                    if (isApi || isSocket)
                    {
                        var origin = context.Request.Headers.Origin.ToString();
                        if (origin.Length > 0 && !string.Equals(origin, baseUrl, StringComparison.OrdinalIgnoreCase))
                            throw new BlackPyException(403, "허용되지 않은 웹 화면입니다.");

                        var supplied = isSocket
                            ? context.Request.Query["token"].ToString()
                            : context.Request.Headers["X-Playground-Token"].ToString();
                        if (!ValidToken(supplied, token)) throw new BlackPyException(401, "연결 토큰이 올바르지 않습니다.");
                    }

                    context.Response.Headers.CacheControl = "no-store";
                    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
                    context.Response.Headers["Referrer-Policy"] = "no-referrer";
                    await next(context);
                }
                catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
                catch (Exception exception) when (!context.Response.HasStarted)
                {
                    context.Response.StatusCode = exception switch
                    {
                        BlackPyException blackPy => blackPy.StatusCode,
                        JsonException or ArgumentException => 400,
                        BadHttpRequestException badRequest => badRequest.StatusCode,
                        _ => 500
                    };
                    await context.Response.WriteAsJsonAsync(new { error = exception.Message });
                }
            });
            app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(15) });
            app.UseDefaultFiles();
            app.UseStaticFiles();
            app.MapGet("/api/state", async context =>
                await context.Response.WriteAsJsonAsync(await session!.GetStateAsync()));
            app.MapGet("/api/project", async context =>
                await context.Response.WriteAsJsonAsync(await session!.GetProjectAsync()));
            app.MapGet("/api/source", async context =>
                await context.Response.WriteAsJsonAsync(
                    await session!.GetSourceAsync(context.Request.Query["runId"].ToString())));
            app.MapGet("/api/events", async context =>
            {
                var events = await session!.GetEventsAsync(context.Request.Query["runId"].ToString());
                await context.Response.WriteAsJsonAsync(new { events });
            });
            app.MapPost("/api/input", async context =>
            {
                var request = await context.Request.ReadFromJsonAsync<InputRequest>(StateMessage.JsonOptions);
                if (request == null) throw new BlackPyException(400, "입력이 필요합니다.");
                await session!.InputAsync(request);
                await context.Response.WriteAsJsonAsync(new { ok = true });
            });
            app.MapPost("/api/run", async context =>
            {
                await session!.RunAsync();
                await context.Response.WriteAsJsonAsync(new { ok = true });
            });
            app.MapPost("/api/stop", async context =>
            {
                await session!.StopAsync();
                await context.Response.WriteAsJsonAsync(new { ok = true });
            });
            app.MapPost("/api/restart", async context =>
            {
                await session!.RestartAsync();
                await context.Response.WriteAsJsonAsync(new { ok = true });
            });
            app.MapPost("/api/frame", async (HttpContext context) =>
            {
                var request = await context.Request.ReadFromJsonAsync<SceneFrameRequest>(StateMessage.JsonOptions);
                if (request == null) throw new BlackPyException(400, "장면이 필요합니다.");
                await session!.FrameAsync(request).WaitAsync(context.RequestAborted);
                await context.Response.WriteAsJsonAsync(new { ok = true });
            });
            app.Map("/ws", context => ServeSocketAsync(context, session!, app.Lifetime.ApplicationStopping));

            await app.StartAsync();
            var addresses = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!;
            baseUrl = addresses.Addresses.Single().TrimEnd('/');
            await using var runtime = new RuntimeSession(
                options.Project, python, baseUrl, token, app.Lifetime.StopApplication,
                options.NoBrowser ? null : TimeSpan.FromSeconds(60));
            session = runtime;
            using var stopping = app.Lifetime.ApplicationStopping.Register(() => { _ = runtime.ShutdownAsync(); });
            var browserUrl = baseUrl + "/#token=" + token;
            Console.WriteLine("PLAYGROUND_URL=" + browserUrl);

            if (!options.NoBrowser)
            {
                try { Process.Start(new ProcessStartInfo(browserUrl) { UseShellExecute = true }); }
                catch (Exception exception)
                {
                    throw new InvalidOperationException("브라우저를 열지 못했습니다: " + exception.Message, exception);
                }
            }

            await app.WaitForShutdownAsync();
            return 0;
        }

        private static bool ValidToken(string supplied, string expected)
        {
            var left = Encoding.UTF8.GetBytes(supplied);
            var right = Encoding.UTF8.GetBytes(expected);
            return CryptographicOperations.FixedTimeEquals(left, right);
        }

        private static async Task ServeSocketAsync(
            HttpContext context, RuntimeSession session, CancellationToken stopping)
        {
            if (!context.WebSockets.IsWebSocketRequest)
                throw new BlackPyException(400, "WebSocket 연결이 필요합니다.");

            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, stopping);
            var connection = await session.ConnectAsync();

            try
            {
                var sending = SendStatesAsync(socket, connection, cancellation.Token);
                var receiving = ReceiveSocketAsync(socket, cancellation.Token);
                await Task.WhenAny(sending, receiving);
                cancellation.Cancel();

                try { await Task.WhenAll(sending, receiving); }
                catch (OperationCanceledException) { }
                catch (WebSocketException) { }

                if (socket.State == WebSocketState.CloseReceived)
                    await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
            }
            finally
            {
                try { await session.DisconnectAsync(connection); }
                catch (BlackPyException) { }
            }
        }

        private static async Task SendStatesAsync(
            WebSocket socket, BrowserConnection connection, CancellationToken cancellation)
        {
            var lastOutputRevision = -1L;

            await foreach (var state in connection.Messages.Reader.ReadAllAsync(cancellation))
            {
                var includeOutput = lastOutputRevision != state.OutputRevision;
                var bytes = Encoding.UTF8.GetBytes(state.Serialize(includeOutput));
                await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cancellation);
                lastOutputRevision = state.OutputRevision;
            }
        }

        private static async Task ReceiveSocketAsync(WebSocket socket, CancellationToken cancellation)
        {
            var buffer = new byte[1024];

            while (socket.State == WebSocketState.Open)
            {
                var message = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellation);
                if (message.MessageType == WebSocketMessageType.Close) return;
            }
        }

        private class Options
        {
            public string Project { get; private set; } = Directory.GetCurrentDirectory();
            public int Port { get; private set; }
            public bool NoBrowser { get; private set; }

            public static Options Parse(string[] args)
            {
                var options = new Options();
                var executableDirectory = Path.GetDirectoryName(Environment.ProcessPath);
                if (executableDirectory != null && File.Exists(Path.Combine(executableDirectory, "project.json")))
                    options.Project = executableDirectory;

                for (int i = 0; i < args.Length; i++)
                {
                    switch (args[i])
                    {
                        case "--project" when i + 1 < args.Length:
                            options.Project = Path.GetFullPath(args[++i]);
                            break;
                        case "--port" when i + 1 < args.Length:
                            if (!int.TryParse(args[++i], out var port) || port < 0 || port > 65535)
                                throw new ArgumentException("포트 번호는 0부터 65535까지입니다.");
                            options.Port = port;
                            break;
                        case "--no-browser":
                            options.NoBrowser = true;
                            break;
                        default:
                            throw new ArgumentException("알 수 없는 실행 옵션: " + args[i]);
                    }
                }

                if (!Directory.Exists(options.Project)) throw new ArgumentException("실습 폴더를 찾을 수 없습니다.");
                return options;
            }
        }
    }
}
