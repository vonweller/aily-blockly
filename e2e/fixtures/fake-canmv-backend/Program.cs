using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

const byte Request = 0x01;
const byte Response = 0x02;
const byte Frame = 0x04;
const int HeaderSize = 7;

using Stream input = Console.OpenStandardInput();
using Stream output = Console.OpenStandardOutput();
string? logPath = Environment.GetEnvironmentVariable("AILY_FAKE_CANMV_LOG");
using StreamWriter? log = string.IsNullOrWhiteSpace(logPath) ? null : new StreamWriter(logPath, append: true) { AutoFlush = true };
log?.WriteLine($"start pid={Environment.ProcessId}");
var header = new byte[HeaderSize];
var detectBoardRequests = 0;

while (ReadExact(input, header))
{
    if (header[0] != (byte)'C' || header[1] != (byte)'M') continue;
    int length = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(3)));
    var payload = new byte[length];
    if (!ReadExact(input, payload)) break;
    if (header[2] != Request) continue;

    using JsonDocument request = JsonDocument.Parse(payload);
    JsonElement root = request.RootElement;
    int id = root.GetProperty("id").GetInt32();
    string method = root.GetProperty("method").GetString() ?? "";
    JsonElement parameters = root.GetProperty("params");
    int sourceLength = method == "runScript" ? parameters.GetProperty("script").GetString()?.Length ?? 0 : 0;
    log?.WriteLine($"receive id={id} method={method} bytes={length} sourceChars={sourceLength}");
    object result;
    if (method == "detectBoards")
    {
        detectBoardRequests++;
        result = detectBoardRequests == 1
            ? new { boards = Array.Empty<object>() }
            : new { boards = new[] { new { port = "COM-CYBERCAM", name = "CyberCAM E2E", vid = "1209", pid = "abd1" } } };
    }
    else
    {
        result = ResultFor(method, parameters);
    }
    WriteJson(output, Response, new { id, result });
    log?.WriteLine($"respond id={id} method={method}");
    if (method == "startPreview") WritePreview(output);
}
log?.WriteLine("stdin-eof");

static object ResultFor(string method, JsonElement parameters) => method switch
{
    "connectBoard" => new { port = parameters.GetProperty("port").GetString(), board = "CyberCAM E2E", firmware = "fake" },
    "runScript" => new { status = "ok", output = "fake CyberCAM output\n" },
    "scriptRunning" => new { running = true },
    "startPreview" => new { streamId = "fake-preview" },
    "io.listDir" => new { entries = new[] { new { name = "main.py", type = "file", size = 27, mtime = 0 } } },
    "io.readFile" => new { dataBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes("print(\"fake remote main\")\n")) },
    _ => new { },
};

static bool ReadExact(Stream stream, byte[] buffer)
{
    int offset = 0;
    while (offset < buffer.Length)
    {
        int count = stream.Read(buffer, offset, buffer.Length - offset);
        if (count == 0) return false;
        offset += count;
    }
    return true;
}

static void WriteJson(Stream stream, byte type, object value)
{
    byte[] payload = JsonSerializer.SerializeToUtf8Bytes(value);
    WriteFrame(stream, type, payload);
}

static void WritePreview(Stream stream)
{
    var payload = new byte[] { 1, 0, 0, 0, 0xff, 0xd8, 0xff, 0xd9 };
    WriteFrame(stream, Frame, payload);
}

static void WriteFrame(Stream stream, byte type, byte[] payload)
{
    var header = new byte[HeaderSize];
    header[0] = (byte)'C';
    header[1] = (byte)'M';
    header[2] = type;
    BinaryPrimitives.WriteUInt32LittleEndian(header.AsSpan(3), checked((uint)payload.Length));
    stream.Write(header);
    stream.Write(payload);
    stream.Flush();
}
