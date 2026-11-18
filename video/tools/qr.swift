// A QR code as a PNG, square modules, no smoothing.
//
//   swift video/tools/qr.swift <text> <out.png> [pixels]
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 3 else {
  FileHandle.standardError.write("usage: qr.swift <text> <out.png> [pixels]\n".data(using: .utf8)!)
  exit(1)
}
let text = args[1]
let out = URL(fileURLWithPath: args[2])
let pixels = args.count > 3 ? Double(args[3])! : 600

let filter = CIFilter.qrCodeGenerator()
filter.message = Data(text.utf8)
// M: still reads with a corner smudged, and keeps the modules large
filter.correctionLevel = "M"
guard let code = filter.outputImage else { exit(1) }

// Ink on clear, so the card behind it shows through the light modules
let colored = code.applyingFilter("CIFalseColor", parameters: [
  "inputColor0": CIColor(red: 0x1f / 255, green: 0x29 / 255, blue: 0x33 / 255, alpha: 1),
  "inputColor1": CIColor(red: 1, green: 1, blue: 1, alpha: 0),
])
let scale = (pixels / code.extent.width).rounded(.down)
let big = colored.samplingNearest().transformed(by: CGAffineTransform(scaleX: scale, y: scale))

let context = CIContext()
guard let image = context.createCGImage(big, from: big.extent),
  let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)
else { exit(1) }
CGImageDestinationAddImage(dest, image, nil)
guard CGImageDestinationFinalize(dest) else { exit(1) }
print("\(Int(code.extent.width)) modules, \(image.width)px")
