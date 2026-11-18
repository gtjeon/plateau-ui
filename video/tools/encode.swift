// Frames to an H.264 movie, with what macOS already has.
//
//   swift tools/encode.swift <out.mp4> <fps> <frames-dir> [<frames-dir> ...]
//
// Each directory holds numbered JPEG frames (00000.jpg, 00001.jpg, ...); the
// directories are played one after another, so a cut is the next folder.
// AVFoundation rather than ffmpeg so that nothing has to be installed.

import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

let args = CommandLine.arguments
guard args.count >= 4, let fps = Int32(args[2]) else {
  FileHandle.standardError.write("usage: encode.swift <out.mp4> <fps> <frames-dir> ...\n".data(using: .utf8)!)
  exit(2)
}
let out = URL(fileURLWithPath: args[1])
let dirs = args[3...].map { URL(fileURLWithPath: $0) }

var frames: [URL] = []
for dir in dirs {
  let names = try FileManager.default.contentsOfDirectory(atPath: dir.path)
    .filter { $0.hasSuffix(".jpg") }
    .sorted()
  frames += names.map { dir.appendingPathComponent($0) }
}
guard let first = frames.first,
  let source = CGImageSourceCreateWithURL(first as CFURL, nil),
  let probe = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
  FileHandle.standardError.write("no frames\n".data(using: .utf8)!)
  exit(1)
}
let width = probe.width
let height = probe.height

try? FileManager.default.removeItem(at: out)
let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
let input = AVAssetWriterInput(
  mediaType: .video,
  outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
      // Generous: a city is all fine edges, and YouTube compresses again
      AVVideoAverageBitRateKey: 24_000_000,
      AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      AVVideoMaxKeyFrameIntervalKey: Int(fps) * 2,
    ],
  ])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
  assetWriterInput: input,
  sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
  ])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

let space = CGColorSpace(name: CGColorSpace.sRGB)!
for (index, url) in frames.enumerated() {
  autoreleasepool {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(src, 0, nil)
    else { return }
    while !input.isReadyForMoreMediaData { usleep(1000) }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
    guard let pixels = buffer else { return }
    CVPixelBufferLockBaseAddress(pixels, [])
    let context = CGContext(
      data: CVPixelBufferGetBaseAddress(pixels), width: width, height: height, bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(pixels), space: space,
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    CVPixelBufferUnlockBaseAddress(pixels, [])
    adaptor.append(pixels, withPresentationTime: CMTime(value: CMTimeValue(index), timescale: fps))
  }
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed {
  FileHandle.standardError.write("failed: \(String(describing: writer.error))\n".data(using: .utf8)!)
  exit(1)
}
print("\(out.path)  \(frames.count) frames  \(width)x\(height)  \(fps) fps")
