import AppKit
import WebKit

@MainActor
final class WolfApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var service: Process?
    private let home = URL(string: "http://127.0.0.1:4318/")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appMenu = NSMenu()
        let appItem = NSMenuItem()
        appItem.submenu = appMenu
        menu.addItem(appItem)
        appMenu.addItem(withTitle: "About AUKORA Wolf", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit AUKORA Wolf", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let edit = NSMenu(title: "Edit")
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        editItem.submenu = edit
        menu.addItem(editItem)
        let viewItem = NSMenuItem(title: "View", action: nil, keyEquivalent: "")
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        viewItem.submenu = view
        menu.addItem(viewItem)
        NSApp.mainMenu = menu

        let available = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: min(900, available.width - 40), height: min(900, available.height - 40))
        window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "AUKORA Wolf · Demo"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = NSColor(srgbRed: 0.055, green: 0.065, blue: 0.09, alpha: 1)
        window.minSize = NSSize(width: 360, height: 560)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.allowsBackForwardNavigationGestures = false
        window.contentView = web
        // Keep the Mac titlebar outside the app's native Spatial content.
        window.styleMask.remove(.fullSizeContentView)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        showStatus("Opening your workspace…", detail: "Live public markets. Demo money.")
        Task { await start() }
    }

    private func showStatus(_ title: String, detail: String) {
        func escape(_ value: String) -> String { value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;") }
        web.loadHTMLString("<!doctype html><meta name='color-scheme' content='dark'><body style='margin:0;background:#10131b;color:#e8eaed;font:16px -apple-system;display:grid;place-content:center;height:100vh;text-align:center'><div style='letter-spacing:.16em;color:#81d4b4;font-size:12px'>AUKORA WOLF</div><h1 style='font-size:25px;font-weight:400'>\(escape(title))</h1><p style='color:#b8bcc4;max-width:620px;line-height:1.6'>\(escape(detail))</p></body>", baseURL: nil)
    }

    private func releaseID(_ url: URL) async -> String? {
        var request = URLRequest(url: url)
        request.timeoutInterval = 1
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object["buildId"] as? String
    }

    private func start() async {
        guard let resources = Bundle.main.resourceURL,
              let data = try? Data(contentsOf: resources.appendingPathComponent("release.json")),
              let release = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let expected = release["buildId"] as? String else {
            showStatus("The app bundle needs rebuilding", detail: "The Wolf release record is missing.")
            return
        }
        let probe = home.appendingPathComponent("release.json")
        if let loaded = await releaseID(probe) {
            guard loaded == expected else {
                showStatus("Another Wolf version is running", detail: "Quit the previous Wolf instance, then reopen this app. Your demo positions remain saved.")
                return
            }
            web.load(URLRequest(url: home))
            return
        }
        let support = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/AUKORA Wolf")
        do {
            try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
            let logURL = support.appendingPathComponent("service.log")
            if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
            let log = try FileHandle(forWritingTo: logURL)
            try log.seekToEnd()
            let process = Process()
            let nodeCandidates = ["/usr/local/bin/node", "/opt/homebrew/bin/node"]
            guard let node = nodeCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
                showStatus("Node 24 is required", detail: "Install Node 24.9 or later, then reopen Wolf.")
                return
            }
            process.executableURL = URL(fileURLWithPath: node)
            process.arguments = [resources.appendingPathComponent("app/apps/service/server.mjs").path]
            process.currentDirectoryURL = resources.appendingPathComponent("app")
            var environment = ProcessInfo.processInfo.environment
            environment["WOLF_PORT"] = "4318"
            environment["WOLF_DATA_DIR"] = support.path
            environment["WOLF_BUILD_ID"] = expected
            process.environment = environment
            process.standardOutput = log
            process.standardError = log
            try process.run()
            service = process
            for _ in 0..<60 {
                if await releaseID(probe) == expected {
                    web.load(URLRequest(url: home))
                    return
                }
                if !process.isRunning { break }
                try? await Task.sleep(nanoseconds: 300_000_000)
            }
            showStatus("Wolf could not start", detail: "Your saved demo account is unchanged. Startup details are in Library/Application Support/AUKORA Wolf/service.log.")
        } catch {
            showStatus("Wolf could not start", detail: error.localizedDescription)
        }
    }

    @objc private func reload() { web.reloadFromOrigin() }
    @objc private func showAbout() {
        NSApp.orderFrontStandardAboutPanel(options: [NSApplication.AboutPanelOptionKey.applicationName: "AUKORA Wolf", .applicationVersion: "Native demo · Live public data / Demo money"])
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { if let service, service.isRunning { service.terminate() } }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window?.makeKeyAndOrderFront(nil)
        return true
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" || (url.host == "127.0.0.1" && url.port == 4318) { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated && url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, url.scheme == "https" { NSWorkspace.shared.open(url) }
        return nil
    }
}

@main
struct WolfEntry {
    @MainActor static func main() {
        let application = NSApplication.shared
        let delegate = WolfApp()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
        withExtendedLifetime(delegate) {}
    }
}
