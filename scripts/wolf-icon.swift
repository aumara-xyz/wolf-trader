import AppKit

let output = CommandLine.arguments[1]
let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString + ".iconset")
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels))
        image.lockFocus()
        let context = NSGraphicsContext.current!.cgContext
        context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
        let frame = NSBezierPath(roundedRect: NSRect(x: 32, y: 32, width: 960, height: 960), xRadius: 224, yRadius: 224)
        NSColor(srgbRed: 0.055, green: 0.065, blue: 0.09, alpha: 1).setFill()
        frame.fill()
        NSGradient(starting: NSColor(srgbRed: 0.13, green: 0.21, blue: 0.22, alpha: 1), ending: NSColor(srgbRed: 0.12, green: 0.10, blue: 0.18, alpha: 1))!.draw(in: frame, angle: -45)
        let ring = NSBezierPath(roundedRect: NSRect(x: 96, y: 96, width: 832, height: 832), xRadius: 170, yRadius: 170)
        NSColor(srgbRed: 0.506, green: 0.831, blue: 0.706, alpha: 0.65).setStroke()
        ring.lineWidth = 3
        ring.stroke()
        let mark = NSBezierPath()
        mark.move(to: NSPoint(x: 240, y: 687))
        mark.line(to: NSPoint(x: 350, y: 337))
        mark.line(to: NSPoint(x: 512, y: 590))
        mark.line(to: NSPoint(x: 674, y: 337))
        mark.line(to: NSPoint(x: 784, y: 687))
        mark.lineWidth = 20
        mark.lineCapStyle = .round
        mark.lineJoinStyle = .round
        NSColor(srgbRed: 0.86, green: 0.94, blue: 0.91, alpha: 1).setStroke()
        mark.stroke()
        image.unlockFocus()
        let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let name = "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"
        try bitmap.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent(name))
    }
}
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "icns", directory.path, "-o", output]
try process.run()
process.waitUntilExit()
try FileManager.default.removeItem(at: directory)
if process.terminationStatus != 0 { exit(process.terminationStatus) }
