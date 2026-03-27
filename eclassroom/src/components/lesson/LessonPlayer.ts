import type { LessonStep, Checkpoint } from '@/types/lesson';
import type { Mood } from '@/types/teacher';
import { fetchTTSAudio, revokeTTSUrl } from '@/services/tts';

export type PlayerState = 'idle' | 'playing' | 'paused' | 'checkpoint' | 'completed';

/** Loose interface to avoid circular imports with WhiteboardTeacher */
export interface WhiteboardTeacherLike {
  executeStep(step: LessonStep): Promise<void>;
}

export interface PlayerCallbacks {
  onStepChange: (step: number) => void;
  onMoodChange: (mood: Mood) => void;
  onStateChange: (state: PlayerState) => void;
  onStepComplete: (step: number) => void;
  onCheckpoint: (checkpoint: Checkpoint, stepNumber: number) => void;
  onLessonComplete: () => void;
}

export class LessonPlayer {
  private currentStepIndex = 0;
  private state: PlayerState = 'idle';
  private audioElement: HTMLAudioElement;
  private whiteboardTeacher: WhiteboardTeacherLike;
  private callbacks: PlayerCallbacks;
  private steps: LessonStep[];
  private teacherId: string;
  private currentTTSUrl: string | null = null;
  private abortController: AbortController | null = null;

  constructor(
    audioElement: HTMLAudioElement,
    whiteboardTeacher: WhiteboardTeacherLike,
    steps: LessonStep[],
    teacherId: string,
    callbacks: PlayerCallbacks,
  ) {
    this.audioElement = audioElement;
    this.whiteboardTeacher = whiteboardTeacher;
    this.steps = steps;
    this.teacherId = teacherId;
    this.callbacks = callbacks;
  }

  async play(): Promise<void> {
    if (this.state === 'completed') return;

    if (this.state === 'paused') {
      this.audioElement.play();
      this.setState('playing');
      return;
    }

    this.setState('playing');
    await this.playFromCurrentStep();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.audioElement.pause();
    this.setState('paused');
  }

  async resumeAfterCheckpoint(): Promise<void> {
    if (this.state !== 'checkpoint') return;
    this.callbacks.onStepComplete(this.steps[this.currentStepIndex]!.step);
    this.currentStepIndex++;

    if (this.currentStepIndex >= this.steps.length) {
      this.setState('completed');
      this.callbacks.onLessonComplete();
      return;
    }

    this.setState('playing');
    await this.playFromCurrentStep();
  }

  stop(): void {
    this.abortController?.abort();
    this.audioElement.pause();
    this.audioElement.src = '';
    if (this.currentTTSUrl) {
      revokeTTSUrl(this.currentTTSUrl);
      this.currentTTSUrl = null;
    }
    this.setState('idle');
  }

  getCurrentStep(): number {
    return this.steps[this.currentStepIndex]?.step ?? 0;
  }

  getState(): PlayerState {
    return this.state;
  }

  private async playFromCurrentStep(): Promise<void> {
    while (this.currentStepIndex < this.steps.length && this.state === 'playing') {
      const step = this.steps[this.currentStepIndex]!;
      this.callbacks.onStepChange(step.step);

      // Set mood based on step content
      if (step.checkpoint) {
        this.callbacks.onMoodChange('asking');
      } else {
        this.callbacks.onMoodChange('explaining');
      }

      // Execute board actions + TTS audio concurrently
      // Board actions always run; TTS is best-effort
      const boardPromise = this.whiteboardTeacher.executeStep(step);

      // Estimate reading time as fallback when TTS fails (~150 wpm)
      const wordCount = step.voice_script.split(/\s+/).length;
      const readingTimeMs = Math.max(3000, (wordCount / 150) * 60 * 1000);

      let audioPlayed = false;
      try {
        const audioUrl = await fetchTTSAudio(step.voice_script, this.teacherId);
        if (this.state !== 'playing') {
          revokeTTSUrl(audioUrl);
          return;
        }

        this.currentTTSUrl = audioUrl;
        this.audioElement.src = audioUrl;

        const audioPromise = new Promise<void>((resolve) => {
          this.audioElement.onended = () => resolve();
          this.audioElement.onerror = () => resolve();
        });

        await this.audioElement.play();
        audioPlayed = true;

        // Wait for both audio and board actions
        await Promise.all([audioPromise, boardPromise]);

        if (this.currentTTSUrl) {
          revokeTTSUrl(this.currentTTSUrl);
          this.currentTTSUrl = null;
        }
      } catch (_err) {
        // TTS failed — wait for board actions + simulated reading time
        if (this.state !== 'playing') return;

        if (!audioPlayed) {
          // Wait for board drawing to complete + reading time as fallback
          await Promise.all([
            boardPromise,
            this.delay(readingTimeMs),
          ]);
        }
      }

      if (this.state !== 'playing') return;

      // Check for checkpoint
      if (step.checkpoint) {
        this.callbacks.onMoodChange('asking');
        this.setState('checkpoint');
        this.callbacks.onCheckpoint(step.checkpoint, step.step);
        return; // Pauses until resumeAfterCheckpoint()
      }

      // Mark step complete and advance
      this.callbacks.onStepComplete(step.step);
      this.callbacks.onMoodChange('encouraging');
      this.currentStepIndex++;
    }

    if (this.currentStepIndex >= this.steps.length) {
      this.setState('completed');
      this.callbacks.onLessonComplete();
    }
  }

  private setState(state: PlayerState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
