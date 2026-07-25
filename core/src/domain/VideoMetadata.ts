/**
 * Video metadata attached to audio sources that originated from video files.
 * This allows the DAW to track video-specific information and support video export.
 */
export interface VideoMetadata {
  /**
   * Frames per second of the source video
   */
  readonly fps: number;

  /**
   * Video frame width in pixels
   */
  readonly width: number;

  /**
   * Video frame height in pixels
   */
  readonly height: number;

  /**
   * Video codec used in the source file (e.g., "h264", "vp9")
   */
  readonly codec: string;

  /**
   * Container format of the source file (e.g., "mp4", "webm", "mov")
   */
  readonly format: string;

  /**
   * Total number of frames in the source video
   */
  readonly frameCount: number;

  /**
   * Whether the source video file contained audio
   * (audio will have been extracted to the Source's AudioBuffer)
   */
  readonly hasAudio: boolean;

  /**
   * Optional data URL for a thumbnail image of the video
   * Used for timeline preview
   */
  readonly thumbnailUrl?: string;

  /**
   * Original video file URL (blob URL or file path)
   * Used for video export and frame extraction
   */
  readonly originalVideoUrl: string;
}
