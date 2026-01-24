import type {
  ConversationPhase,
  UserState,
  DayPlan,
  ExerciseLog,
  WorkoutLog,
} from '../types/index.js';

const DEFAULT_STATE: UserState = {
  phase: 'idle',
  todayPlan: null,
  currentWorkoutLog: {},
  scheduledWorkoutTime: null,
  lastMessageAt: new Date().toISOString(),
  messageBuffer: [],
};

export class StateService {
  private state: UserState;

  constructor() {
    this.state = { ...DEFAULT_STATE };
  }

  getState(): UserState {
    return { ...this.state };
  }

  getPhase(): ConversationPhase {
    return this.state.phase;
  }

  updatePhase(phase: ConversationPhase): void {
    this.state.phase = phase;
    this.state.lastMessageAt = new Date().toISOString();
  }

  setTodayPlan(plan: DayPlan): void {
    this.state.todayPlan = plan;
  }

  getTodayPlan(): DayPlan | null {
    return this.state.todayPlan;
  }

  initWorkoutLog(dayType: WorkoutLog['dayType']): void {
    this.state.currentWorkoutLog = {
      date: new Date().toISOString().split('T')[0],
      dayType,
      energy: 7,
      sleepHours: 7,
      skills: [],
      strength: [],
      notes: [],
    };
  }

  setWorkoutMetadata(energy: number, sleepHours: number): void {
    this.state.currentWorkoutLog.energy = energy;
    this.state.currentWorkoutLog.sleepHours = sleepHours;
  }

  addExerciseToLog(exercise: ExerciseLog, category: 'skills' | 'strength'): void {
    if (!this.state.currentWorkoutLog[category]) {
      this.state.currentWorkoutLog[category] = [];
    }
    this.state.currentWorkoutLog[category]!.push(exercise);
    this.state.lastMessageAt = new Date().toISOString();
  }

  addToWorkoutLog(exercise: ExerciseLog): void {
    // Default to strength category
    this.addExerciseToLog(exercise, 'strength');
  }

  getCurrentWorkoutLog(): Partial<WorkoutLog> {
    return { ...this.state.currentWorkoutLog };
  }

  getCompletedWorkoutLog(): WorkoutLog | null {
    const log = this.state.currentWorkoutLog;
    if (!log.date || !log.dayType) {
      return null;
    }

    return {
      date: log.date,
      dayType: log.dayType,
      energy: log.energy || 7,
      sleepHours: log.sleepHours || 7,
      skills: log.skills || [],
      strength: log.strength || [],
      notes: log.notes || [],
    };
  }

  addToBuffer(message: string): void {
    this.state.messageBuffer.push(message);
    this.state.lastMessageAt = new Date().toISOString();
  }

  getBuffer(): string[] {
    return [...this.state.messageBuffer];
  }

  clearBuffer(): string[] {
    const buffer = [...this.state.messageBuffer];
    this.state.messageBuffer = [];
    return buffer;
  }

  scheduleWorkout(time: string): void {
    this.state.scheduledWorkoutTime = time;
  }

  getScheduledWorkoutTime(): string | null {
    return this.state.scheduledWorkoutTime;
  }

  addNote(note: string): void {
    if (!this.state.currentWorkoutLog.notes) {
      this.state.currentWorkoutLog.notes = [];
    }
    this.state.currentWorkoutLog.notes.push(note);
  }

  reset(): void {
    this.state = {
      ...DEFAULT_STATE,
      lastMessageAt: new Date().toISOString(),
    };
  }

  isWorkoutInProgress(): boolean {
    return this.state.phase === 'during-workout';
  }

  getLastMessageTime(): Date {
    return new Date(this.state.lastMessageAt);
  }

  getTimeSinceLastMessage(): number {
    return Date.now() - new Date(this.state.lastMessageAt).getTime();
  }
}
