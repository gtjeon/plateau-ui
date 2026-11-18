// Lays a piece of music under a finished movie: the picture copied as it is
// (not encoded again), the music cut to the movie's length, faded in and out,
// and set to a level.
//
//   swift video/tools/music.swift <movie.mp4> <music> <out.mp4> [from s] [fade-in s] [fade-out s] [gain]
//
// `from` is where in the music to start; the gain is a factor on the samples
// (1 leaves them as they are). The movie's own sound, if it has any, is not kept.
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count >= 4 else {
  FileHandle.standardError.write("usage: music.swift <movie.mp4> <music> <out.mp4> [from] [fade-in] [fade-out] [gain]\n".data(using: .utf8)!)
  exit(1)
}
let movieURL = URL(fileURLWithPath: args[1])
let musicURL = URL(fileURLWithPath: args[2])
let outURL = URL(fileURLWithPath: args[3])
let from = args.count > 4 ? Double(args[4])! : 0
let fadeIn = args.count > 5 ? Double(args[5])! : 1
let fadeOut = args.count > 6 ? Double(args[6])! : 3
let gain = args.count > 7 ? Float(args[7])! : 1

let rate = 48_000
let channels = 2

func fail(_ what: String) -> NSError { NSError(domain: "music", code: 1, userInfo: [NSLocalizedDescriptionKey: what]) }

/** The music from `from` for `length` seconds, as interleaved stereo floats. */
func decode(_ track: AVAssetTrack, _ asset: AVAsset, length: Double) throws -> [Float] {
  let reader = try AVAssetReader(asset: asset)
  reader.timeRange = CMTimeRange(
    start: CMTime(seconds: from, preferredTimescale: 48_000),
    duration: CMTime(seconds: length, preferredTimescale: 48_000))
  let out = AVAssetReaderTrackOutput(
    track: track,
    outputSettings: [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: rate,
      AVNumberOfChannelsKey: channels,
      AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true,
      AVLinearPCMIsNonInterleaved: false,
      AVLinearPCMIsBigEndianKey: false,
    ])
  reader.add(out)
  guard reader.startReading() else { throw reader.error ?? fail("cannot read the music") }
  var all: [Float] = []
  while let sample = out.copyNextSampleBuffer() {
    guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
    let bytes = CMBlockBufferGetDataLength(block)
    var chunk = [Float](repeating: 0, count: bytes / 4)
    chunk.withUnsafeMutableBytes { _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: bytes, destination: $0.baseAddress!) }
    all += chunk
  }
  return all
}

func run() async throws {
  let movie = AVURLAsset(url: movieURL)
  let music = AVURLAsset(url: musicURL)
  let length = try await movie.load(.duration).seconds
  guard let videoTrack = try await movie.loadTracks(withMediaType: .video).first else { throw fail("no picture in the movie") }
  guard let musicTrack = try await music.loadTracks(withMediaType: .audio).first else { throw fail("no sound in the music") }

  // The music, cut, faded and levelled, all in hand before anything is written
  var samples = try decode(musicTrack, music, length: length)
  let wanted = Int(length * Double(rate)) * channels
  if samples.count < wanted { samples += [Float](repeating: 0, count: wanted - samples.count) }
  if samples.count > wanted { samples.removeLast(samples.count - wanted) }
  for frame in 0..<(wanted / channels) {
    let t = Double(frame) / Double(rate)
    var k = gain
    if t < fadeIn { k *= Float(t / fadeIn) }
    if t > length - fadeOut { k *= Float(max(0, (length - t) / fadeOut)) }
    for c in 0..<channels { samples[frame * channels + c] *= k }
  }
  let loudest = samples.reduce(Float(0)) { max($0, abs($1)) }

  var description = AudioStreamBasicDescription(
    mSampleRate: Double(rate), mFormatID: kAudioFormatLinearPCM,
    mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
    mBytesPerPacket: UInt32(4 * channels), mFramesPerPacket: 1, mBytesPerFrame: UInt32(4 * channels),
    mChannelsPerFrame: UInt32(channels), mBitsPerChannel: 32, mReserved: 0)
  var format: CMAudioFormatDescription?
  CMAudioFormatDescriptionCreate(allocator: nil, asbd: &description, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &format)

  try? FileManager.default.removeItem(at: outURL)
  let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
  let videoFormat = try await videoTrack.load(.formatDescriptions).first
  let videoIn = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: videoFormat)
  videoIn.expectsMediaDataInRealTime = false
  writer.add(videoIn)
  let audioIn = AVAssetWriterInput(
    mediaType: .audio,
    outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: channels, AVEncoderBitRateKey: 256_000])
  audioIn.expectsMediaDataInRealTime = false
  writer.add(audioIn)

  let videoReader = try AVAssetReader(asset: movie)
  let videoOut = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: nil)
  videoReader.add(videoOut)
  guard videoReader.startReading() else { throw videoReader.error ?? fail("cannot read the movie") }

  writer.startWriting()
  writer.startSession(atSourceTime: .zero)

  // Both fed as the writer asks, each on its own queue: it interleaves them,
  // and one fed to the end before the other can stall it
  let group = DispatchGroup()
  group.enter()
  videoIn.requestMediaDataWhenReady(on: DispatchQueue(label: "picture")) {
    while videoIn.isReadyForMoreMediaData {
      guard let sample = videoOut.copyNextSampleBuffer() else {
        videoIn.markAsFinished()
        group.leave()
        return
      }
      videoIn.append(sample)
    }
  }
  group.enter()
  var next = 0
  let chunk = 4096
  let frames = wanted / channels
  audioIn.requestMediaDataWhenReady(on: DispatchQueue(label: "music")) {
    while audioIn.isReadyForMoreMediaData {
      if next >= frames {
        audioIn.markAsFinished()
        group.leave()
        return
      }
      let count = min(chunk, frames - next)
      let bytes = count * channels * 4
      var block: CMBlockBuffer?
      CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: bytes, blockAllocator: nil, customBlockSource: nil, offsetToData: 0, dataLength: bytes, flags: 0, blockBufferOut: &block)
      samples.withUnsafeBytes { all in
        _ = CMBlockBufferReplaceDataBytes(with: all.baseAddress! + next * channels * 4, blockBuffer: block!, offsetIntoDestination: 0, dataLength: bytes)
      }
      var sample: CMSampleBuffer?
      CMAudioSampleBufferCreateReadyWithPacketDescriptions(
        allocator: nil, dataBuffer: block!, formatDescription: format!, sampleCount: count,
        presentationTimeStamp: CMTime(value: CMTimeValue(next), timescale: CMTimeScale(rate)),
        packetDescriptions: nil, sampleBufferOut: &sample)
      audioIn.append(sample!)
      next += count
    }
  }
  group.wait()
  await writer.finishWriting()
  if writer.status != .completed { throw writer.error ?? fail("writing failed") }
  print(String(format: "%@  %.2f s, music from %.2f s, in %.1f s, out %.1f s, gain %.2f, loudest %.3f", outURL.path, length, from, fadeIn, fadeOut, gain, loudest))
}

let done = DispatchSemaphore(value: 0)
Task {
  do { try await run() } catch {
    FileHandle.standardError.write("\(error)\n".data(using: .utf8)!)
    exit(1)
  }
  done.signal()
}
done.wait()
