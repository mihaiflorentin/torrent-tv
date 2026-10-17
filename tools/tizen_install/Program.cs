using System.Diagnostics;
using Apps2Samsung.Certificate;
using Apps2Samsung.Helpers.Tizen.Certificate;
using Apps2Samsung.Interfaces;
using Apps2Samsung.Models;
using Apps2Samsung.Packaging;
using Apps2Samsung.Sdb;

// Headless equivalent of the Apps2Samsung GUI "custom .wgt" install (TizenInstallerService.InstallPackageAsync),
// reusing an existing certificate profile. Never triggers a Samsung login: it stops when one would be needed.
string? tv = null, wgt = null, sdbExe = Environment.GetEnvironmentVariable("TIZEN_SDB");
var cfgDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config", "Apps2Samsung");
var level = CertificatePrivilegeLevel.Public;
for (int i = 0; i < args.Length; i++)
{
    if (args[i] == "--tv" && i + 1 < args.Length) tv = args[++i];
    else if (args[i] == "--wgt" && i + 1 < args.Length) wgt = args[++i];
    else if (args[i] == "--sdb" && i + 1 < args.Length) sdbExe = args[++i];
    else if (args[i] == "--partner") level = CertificatePrivilegeLevel.Partner;
}
if (tv is null || wgt is null || !File.Exists(wgt)) { Console.Error.WriteLine("usage: tizen-install --tv <ip> --wgt <file.wgt> [--sdb <tizensdb>] [--partner]"); return 2; }

// tizensdb (github.com/PatrickSt1991/tizen-sdb): --sdb, TIZEN_SDB, or .cache/tizensdb beside the project.
if (string.IsNullOrEmpty(sdbExe))
    sdbExe = new[] { Path.Combine(AppContext.BaseDirectory, ".cache", "tizensdb"), Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../.cache/tizensdb")) }
        .FirstOrDefault(File.Exists);
if (sdbExe is null || !File.Exists(sdbExe)) { Console.Error.WriteLine("tizensdb not found: pass --sdb, set TIZEN_SDB, or run `make tizen-sdb`."); return 2; }
var sdb = new CliSdb(sdbExe);

// Work on a copy: resign rewrites the package in place.
var work = Path.Combine(Path.GetTempPath(), "tizen-install-" + Guid.NewGuid().ToString("N")[..8]);
Directory.CreateDirectory(work);
var pkg = Path.Combine(work, Path.GetFileName(wgt));
File.Copy(wgt, pkg);
void Log(string s) => Console.WriteLine($"[tizen-install] {s}");

try
{
    Log($"capability {tv}");
    var cap = await sdb.CapabilityAsync(tv);
    var caps = TizenCapabilities.Parse(cap.Output);
    if (!Version.TryParse(caps.PlatformVersion, out var tizen)) { Log("FAIL: cannot read platform_version (TV unreachable, or Developer Mode off / host IP not this computer?)"); return 3; }
    Log($"platform Tizen {tizen}, sdk_toolpath {caps.SdkToolPath}");

    var duid = await TizenDuidReader.ReadAsync(sdb, tv, progress: Log);
    Log($"DUID {duid}");

    var req = await WgtManifest.ReadRequiredVersionAsync(pkg);
    if (WgtManifest.RequiresNewerTizen(tizen, req)) { Log($"FAIL: package requires Tizen {req}, TV is {tizen}"); return 4; }

    var profileDir = Path.Combine(cfgDir, "Certificate", CertificateProvisioningService.ProfileName(level));
    if (!CertificateProvisioningService.HasUsableAuthorCert(profileDir)) { Log($"STOP: no usable author certificate in '{profileDir}'. Create one with a Samsung login in the Apps2Samsung GUI."); return 5; }
    var covered = CertificateProvisioningService.GetCoveredDuids(profileDir);
    if (!covered.Contains(duid, StringComparer.OrdinalIgnoreCase)) { Log($"STOP: the distributor certificate does not cover DUID {duid} (it covers {covered.Count} other TVs). Install once from the Apps2Samsung GUI on this TV to regenerate it with a Samsung login."); return 6; }
    var password = File.ReadAllText(Path.Combine(profileDir, "password.txt")).Trim();
    Log($"certificate profile '{Path.GetFileName(profileDir)}' covers this TV");

    if (TizenPermitInstall.IsRequired(tizen))
        await TizenPermitInstall.EnsureAsync(sdb, tv, tizen, caps.SdkToolPath, Path.Combine(profileDir, "device-profile.xml"));

    Log("resigning");
    var rs = await sdb.ResignAsync(pkg, Path.Combine(profileDir, "author.p12"), Path.Combine(profileDir, "distributor.p12"), password);
    if (rs.ExitCode != 0 || rs.Output.Contains("resign failed", StringComparison.OrdinalIgnoreCase)) { Log(rs.Output.Trim()); Log("FAIL: resign"); return 7; }

    Log("installing");
    var ins = await sdb.InstallAsync(tv, pkg, caps.SdkToolPath);
    Log(ins.Output.Trim());
    if (TizenInstallDiagnostics.IsCertificateMismatch(ins.Output)) { Log("FAIL: certificate mismatch with the installed copy (uninstall the old app on the TV first)."); return 8; }
    if (TizenInstallDiagnostics.IndicatesSuccess(ins.Output) && !TizenInstallDiagnostics.IndicatesFailure(ins.Output)) { Log("SUCCESS: install completed"); return 0; }
    Log("FAIL: install did not report success");
    return 9;
}
finally
{
    try { await sdb.DisconnectAsync(tv); } catch { }
    try { Directory.Delete(work, true); } catch { }
}

// ISdbEngine over the tizensdb command line; only the calls the install path needs are real.
sealed class CliSdb(string exe) : ISdbEngine
{
    Task<ProcessResult> Run(params string[] args)
    {
        var psi = new ProcessStartInfo(exe);
        foreach (var a in args) psi.ArgumentList.Add(a);
        return Start(psi);
    }
    // A shell command stays one command line, split by the usual quoting rules, as the GUI passes it.
    Task<ProcessResult> RunRaw(string commandLine) => Start(new ProcessStartInfo(exe, commandLine));
    static async Task<ProcessResult> Start(ProcessStartInfo psi)
    {
        psi.RedirectStandardOutput = true; psi.RedirectStandardError = true; psi.UseShellExecute = false;
        using var p = Process.Start(psi)!;
        var o = p.StandardOutput.ReadToEndAsync(); var e = p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        return new ProcessResult { ExitCode = p.ExitCode, Output = (await o) + (await e), Error = await e };
    }
    public Task<ProcessResult> DevicesAsync(string ip) => Run("devices", ip);
    public Task<ProcessResult> DisconnectAsync(string ip) => Run("disconnect", ip);
    public Task<ProcessResult> CapabilityAsync(string ip) => Run("capability", ip);
    public Task<ProcessResult> DuidAsync(string ip) => Run("duid", ip);
    public Task<ProcessResult> DiagnoseAsync(string ip) => Run("diagnose", ip);
    public Task<ProcessResult> AppsAsync(string ip) => Run("apps", ip);
    public Task<ProcessResult> LaunchAsync(string ip, string id) => Run("launch", ip, id);
    public Task<ProcessResult> ResignAsync(string p, string a, string d, string pw) => Run("resign", p, a, d, pw);
    public Task<ProcessResult> InstallAsync(string ip, string p, string sdk) => Run("install", ip, p, sdk);
    public Task<ProcessResult> UninstallAsync(string ip, string id) => Run("uninstall", ip, id);
    public Task<ProcessResult> PermitInstallAsync(string ip, string x, string sdk) => Run("permit-install", ip, x, sdk);
    public Task<ProcessResult> ShellAsync(string ip, string c) => RunRaw($"shell {ip} {c}");
    public Task<IAsyncDisposable> ForwardAsync(string ip, int l, int r) => throw new NotSupportedException();
}
