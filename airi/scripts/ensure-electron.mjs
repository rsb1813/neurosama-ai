// Electron 바이너리 보강 — pnpm이 차단한 electron 다운로드/추출을 마무리한다(neru 데스크톱 패키징용).
//
// 배경: pnpm 10+는 의존성 postinstall(=electron 바이너리 추출)을 기본 차단하고,
// electron의 extract-zip이 이 머신에서 조용히 실패해(dist에 dxil.dll만 남음) 앱이
// "Electron uninstall"로 죽는다. 여기서는 캐시된 zip을 시스템 tar로 직접 풀고
// path.txt를 채워, override 없이 electron-vite가 바이너리를 찾게 한다. 멱등적.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const arch = process.arch === "arm64" ? "arm64" : "x64";
const platform = process.platform; // win32 / darwin / linux
const exeName = platform === "win32" ? "electron.exe" : "electron";
const cacheRoot = join(homedir(), "AppData", "Local", "electron", "Cache");
const pnpmDir = join(process.cwd(), "node_modules", ".pnpm");

function findElectronPkgs() {
  if (!existsSync(pnpmDir)) return [];
  return readdirSync(pnpmDir)
    .filter((name) => /^electron@\d/.test(name))
    .map((name) => join(pnpmDir, name, "node_modules", "electron"))
    .filter((p) => existsSync(join(p, "package.json")));
}

function findCachedZip(version) {
  // ~/AppData/Local/electron/Cache/<hash>/electron-v<ver>-<platform>-<arch>.zip
  if (!existsSync(cacheRoot)) return null;
  const wanted = `electron-v${version}-${platform}-${arch}.zip`;
  for (const hash of readdirSync(cacheRoot)) {
    const candidate = join(cacheRoot, hash, wanted);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

for (const pkg of findElectronPkgs()) {
  const distExe = join(pkg, "dist", exeName);
  if (existsSync(distExe)) continue; // 이미 정상

  const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf-8")).version;
  let zip = findCachedZip(version);
  if (!zip) {
    // 캐시에 없으면 electron 패키지의 install.js로 zip만 내려받는다(추출은 실패해도 무방).
    try {
      execFileSync(process.execPath, ["install.js"], { cwd: pkg, stdio: "ignore" });
    } catch {
      // 추출 단계 실패는 무시 — 아래에서 tar로 다시 푼다.
    }
    zip = findCachedZip(version);
  }
  if (!zip) {
    console.error(`[ensure-electron] electron@${version} zip을 찾지 못했습니다. 네트워크 확인 필요.`);
    process.exitCode = 1;
    continue;
  }

  const dist = join(pkg, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  // 시스템 tar(bsdtar)는 zip을 안정적으로 푼다(Node extract-zip 회피).
  execFileSync("tar", ["-xf", zip, "-C", dist], { stdio: "ignore" });
  writeFileSync(join(pkg, "path.txt"), exeName);
  console.log(`[ensure-electron] electron@${version} 바이너리 추출 완료`);
}
