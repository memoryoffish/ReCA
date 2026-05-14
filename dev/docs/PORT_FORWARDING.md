# Port Forwarding from a `code tunnel` Host to a Real Browser

> Why `Forward Port` in VSCode's PORTS panel does **nothing** when you're
> connected via `code tunnel` (vscode.dev or web-embedded VSCode like Aliyun
> DSW), what Microsoft has said about it, and the four ways to get a working
> URL anyway.

---

## 1. Symptom

You open the PORTS panel in VSCode, click **转发端口 / Forward Port**, type
e.g. `8800`, hit Enter, and:

- A toast pops up immediately:
  ```
  无法转发 localhost: 8800. 主机可能不可用，或者远程端口可能已被转发
  (Unable to forward localhost:8800. The host may not be available
   or that remote port may already be forwarded.)
  ```
- The "Forwarded Ports" list **stays empty** — no row is added.
- Any port you try (8800, 18800, 22000…) fails the same way, instantly.

The error is **not** about your service. Verify:

```bash
# uvicorn is healthy
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8800/
# → HTTP 200
```

If `200` comes back, the local service is fine. The problem is upstream of
that, in VSCode's tunnel control plane.

---

## 2. Root cause (from the VS Code source)

VSCode's PORTS panel calls `remoteExplorerService.forward(...)` when you
click the button. The implementation is in
[`src/vs/workbench/services/remote/common/tunnelModel.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/remote/common/tunnelModel.ts):

```ts
async forward(tunnelProperties, attributes?) {
  if (!this.restoreComplete && this.environmentService.remoteAuthority) {
    await Event.toPromise(this.onRestoreComplete.event);
  }
  return this.doForward(tunnelProperties, attributes);
}
```

`doForward()` in turn delegates to `tunnelService.openTunnel(...)`, which is
provided by a **TunnelProvider** registered by the active remote extension:

- Remote-SSH → SSH-tunnel-based provider (works fine)
- Codespaces (paid) → Microsoft's hosted dev-tunnels-with-HTTPS provider
- **`code tunnel` (free, what you use)** → a degenerate provider that
  short-circuits and returns `undefined` synchronously without doing any
  network operation

When `openTunnel` returns `undefined`, control flows back to the UI which
fires the warn in
[`src/vs/workbench/contrib/remote/browser/tunnelView.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/remote/browser/tunnelView.ts):

```ts
function error(notificationService, tunnelOrError, host, port) {
  if (!tunnelOrError) {                   // ← falsy: undefined / null
    notificationService.warn(nls.localize(
      'remote.tunnel.forwardError',
      "Unable to forward {0}:{1}. The host may not be available or
       that remote port may already be forwarded", host, port));
  } else if (typeof tunnelOrError === 'string') {
    notificationService.warn(/* uses the string */);
  }
}
```

Key insight: the warn message contains **two** guesses ("host may not be
available" OR "port may already be forwarded") and it fires for **any** falsy
return. It does not actually probe the host. It does not actually check the
port list. **It's a catch-all that simply says "something failed, here are
two things it could be."**

In your environment the truth is neither of those guesses. The truth is
"the TunnelProvider for `code tunnel` web returns undefined immediately."

That also explains why your port list stays empty: the "add row to list" call
only runs on the success path of `doForward()`. Since `openTunnel` returns
undefined before that path is reached, no entry is ever created.

---

## 3. Microsoft has explicitly stated this won't be fixed

| Issue | Filed | Status | Notes |
|---|---|---|---|
| [microsoft/vscode#175457](https://github.com/microsoft/vscode/issues/175457) — "Port Forwarding isn't working when using Remote Tunnel" | Feb 2023 | **Closed as not planned** | Original Remote-Tunnels report |
| [microsoft/vscode#186847](https://github.com/microsoft/vscode/issues/186847) — "Not able to forward a port in vscode.dev" | Jul 2023 | **Closed** | Same symptom, web client |
| [community#63318](https://github.com/orgs/community/discussions/63318) — "Can't forward ports from any Codespace in VSCode for Web" | 2023 | Abandoned, bot-dormant | No maintainer reply |
| [community#61154](https://github.com/orgs/community/discussions/61154) | 2023 | Closed "account-specific" | Unrelated fix |

It is now May 2026. None of these have been reopened. The implementation
gap is intentional — `code tunnel` web is positioned as a free code-editor
viewer, port forwarding is a paid feature of GitHub Codespaces (built on the
same Azure Dev Tunnels service). Filing a new issue will not change this.

---

## 4. Four ways to get a working URL anyway

Pick the first that fits your environment. All four bypass the broken
PORTS button entirely; you do not have to fix VSCode.

### 4.1. SSH reverse tunnel to `localhost.run`  *(preferred)*

Zero dependencies — just OpenSSH client, which DSW already has. Outputs
a public HTTPS URL in 5 seconds.

```bash
# In a second terminal on the DSW machine, with uvicorn already on 8800:
ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -i /dev/null \
    -R 80:localhost:8800 nokey@localhost.run
```

Output:
```
** your https forwarded URL is:
https://abc123def.lhr.life
```

Paste that into any browser. Works without any account.

Variations if `localhost.run` is unreachable (some networks block port 22
outbound to that host):
- `ssh -R 80:localhost:8800 serveo.net`
- `ssh -p 443 -R0:localhost:8800 a.pinggy.io`  *(uses 443, often allowed when 22 isn't)*

### 4.2. cloudflared  *(fallback when SSH outbound is blocked)*

Falls back to HTTPS-only egress to GitHub releases and Cloudflare. ~30 MB
download, no signup.

```bash
curl -L -o /tmp/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x /tmp/cloudflared
/tmp/cloudflared tunnel --url http://localhost:8800
```

Output includes `https://xxxxx.trycloudflare.com`.

### 4.3. Local desktop VSCode + Remote-SSH  *(long-term, most stable)*

Once-off setup, then VSCode's PORTS panel actually works because Remote-SSH
uses an SSH tunnel (which has a real TunnelProvider, not a stub):

1. Install desktop VSCode on your laptop: <https://code.visualstudio.com/>
2. Install the **Remote - SSH** extension (not "Remote - Tunnels")
3. Get the DSW SSH connection string from the DSW console
4. `Remote-SSH: Connect to Host…` → enter it → opens a new window
5. Open the demo folder, run `uvicorn ...`, then use PORTS panel — it works.

### 4.4. DSW's own gateway URL  *(loads HTML but breaks CSS/JS)*

Aliyun DSW exposes any port on the instance through a gateway URL:

```
https://dsw-gateway-cn-wulanchabu.data.aliyun.com/dsw-<your-id>/ide/proxy/<port>/
```

It works for *getting bytes back* but, because our HTML uses root-absolute
asset paths (`/static/app.css`), they resolve under the gateway domain root
rather than under the proxy prefix and **break**. Use for a quick smoke
test of "is the HTML reachable at all", not for normal development.

Required: open in the **same browser session where you're logged into the
DSW console**, otherwise you get `{"code":403,...,"账号校验失败"}`.

---

## 5. Decision tree

```
                ┌──────────────────────────────┐
                │ Just want to see the page    │
                │ for 30 seconds, smoke test?  │
                └──────────────┬───────────────┘
                               │
                       ┌───────┴───────┐
                       │ Try 4.1 (SSH) │
                       └───────┬───────┘
                               │
                      ┌────────┴────────┐
                      │ Success?        │
                      └─┬─────────────┬─┘
                        │             │
                       yes            no (port 22 blocked)
                        │             │
              done, open URL   ┌──────┴──────┐
                               │ Try 4.2     │
                               │ (cloudflared)│
                               └──────┬──────┘
                                      │
                            ┌─────────┴─────────┐
                            │ Success?          │
                            └─┬───────────────┬─┘
                              │               │
                            yes              no
                              │               │
                       done, open URL   ┌────┴────────┐
                                        │ Try 4.3     │
                                        │ Remote-SSH  │
                                        └─────────────┘

                ┌──────────────────────────────┐
                │ Long-term dev, want it to    │
                │ just work like SSH normally? │
                └──────────────┬───────────────┘
                               │
                        ┌──────┴───────────┐
                        │ Set up 4.3 once  │
                        │ (Remote-SSH)     │
                        └──────────────────┘
```

---

## 6. Automated helper: `scripts/dev-tunnel.sh`

To save typing, we ship a single script that does **uvicorn + 4.1 reverse
tunnel** in one command and prints the URL:

```bash
# From this directory:
PORT=8800 ./scripts/dev-tunnel.sh
```

It starts uvicorn in the background, waits for `/api/healthcheck` to return
200, then opens an SSH reverse tunnel and prints the public URL.
`Ctrl+C` kills both processes cleanly.

If SSH to `localhost.run` is blocked in your environment, set
`USE_CLOUDFLARED=1` and the script will download `cloudflared` to `/tmp`
and use 4.2 instead:

```bash
USE_CLOUDFLARED=1 PORT=8800 ./scripts/dev-tunnel.sh
```

See `scripts/dev-tunnel.sh` for the implementation.

---

## 7. What if you really want to "fix it" in VSCode

You can't — the TunnelProvider for `code tunnel` web is a closed-source stub
hosted by Microsoft, not a piece of the open-source VSCode you can patch
yourself. The only paths that genuinely re-enable port forwarding are:

1. Switch to **GitHub Codespaces** (paid, has a working provider)
2. Switch to **Remote-SSH** (4.3 above, free, works)
3. Wait for Microsoft to flip the bit (they explicitly said they won't)

In all three cases the "fix" is to change the connection mode, not to fix
VSCode itself. Therefore the right engineering move is to **stop treating
the VSCode button as the path**, and use the helper script (§6) instead.

---

## 8. Source citations

| File | What it shows |
|---|---|
| [`src/vs/workbench/services/remote/common/tunnelModel.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/remote/common/tunnelModel.ts) | `forward()` and `doForward()` — the 3 falsy-return paths |
| [`src/vs/workbench/contrib/remote/browser/tunnelView.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/remote/browser/tunnelView.ts) | `ForwardPortAction.error()` — where the catch-all warn fires |
| [`src/vs/platform/tunnel/common/tunnel.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/tunnel/common/tunnel.ts) | `ITunnelService.openTunnel()` and TunnelProvider registration |
| [microsoft/vscode#175457](https://github.com/microsoft/vscode/issues/175457) | Original bug; closed "not planned" |
| [microsoft/vscode#186847](https://github.com/microsoft/vscode/issues/186847) | Same bug, web client |
| [Microsoft Azure Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/overview) | Underlying paid service `code tunnel` proxies to |
