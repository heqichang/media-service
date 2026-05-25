import { config } from '../config';
import { TimelineSnapshot, HistoryEntry } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class VideoEditHistoryService {
  private history: Map<string, HistoryEntry[]> = new Map();
  private currentIndex: Map<string, number> = new Map();
  private maxHistorySize: number = config.videoEdit.maxHistorySize;

  createSnapshot(projectId: string, tracks: any[], duration: number): TimelineSnapshot {
    return {
      tracks: JSON.parse(JSON.stringify(tracks)),
      duration,
    };
  }

  saveState(projectId: string, action: string, snapshot: TimelineSnapshot): void {
    let projectHistory = this.history.get(projectId) || [];
    const currentIdx = this.currentIndex.get(projectId) ?? -1;

    if (currentIdx < projectHistory.length - 1) {
      projectHistory = projectHistory.slice(0, currentIdx + 1);
    }

    const entry: HistoryEntry = {
      id: uuidv4(),
      action,
      snapshot: JSON.parse(JSON.stringify(snapshot)),
      timestamp: new Date(),
    };

    projectHistory.push(entry);

    if (projectHistory.length > this.maxHistorySize) {
      projectHistory = projectHistory.slice(projectHistory.length - this.maxHistorySize);
    }

    this.history.set(projectId, projectHistory);
    this.currentIndex.set(projectId, projectHistory.length - 1);
  }

  undo(projectId: string): TimelineSnapshot | null {
    const projectHistory = this.history.get(projectId);
    const currentIdx = this.currentIndex.get(projectId) ?? -1;

    if (!projectHistory || projectHistory.length === 0) {
      return null;
    }

    if (currentIdx <= 0) {
      return null;
    }

    const newIndex = currentIdx - 1;
    this.currentIndex.set(projectId, newIndex);

    return JSON.parse(JSON.stringify(projectHistory[newIndex].snapshot));
  }

  redo(projectId: string): TimelineSnapshot | null {
    const projectHistory = this.history.get(projectId);
    const currentIdx = this.currentIndex.get(projectId) ?? -1;

    if (!projectHistory || projectHistory.length === 0) {
      return null;
    }

    if (currentIdx >= projectHistory.length - 1) {
      return null;
    }

    const newIndex = currentIdx + 1;
    this.currentIndex.set(projectId, newIndex);

    return JSON.parse(JSON.stringify(projectHistory[newIndex].snapshot));
  }

  canUndo(projectId: string): boolean {
    const currentIdx = this.currentIndex.get(projectId) ?? -1;
    return currentIdx > 0;
  }

  canRedo(projectId: string): boolean {
    const projectHistory = this.history.get(projectId);
    const currentIdx = this.currentIndex.get(projectId) ?? -1;
    return projectHistory !== undefined && currentIdx < projectHistory.length - 1;
  }

  getHistory(projectId: string): HistoryEntry[] {
    return this.history.get(projectId) || [];
  }

  getCurrentIndex(projectId: string): number {
    return this.currentIndex.get(projectId) ?? -1;
  }

  clearHistory(projectId: string): void {
    this.history.delete(projectId);
    this.currentIndex.delete(projectId);
  }

  loadFromDatabase(projectId: string, historyEntries: any[]): void {
    if (historyEntries && historyEntries.length > 0) {
      const sorted = historyEntries.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      this.history.set(projectId, sorted as HistoryEntry[]);
      this.currentIndex.set(projectId, sorted.length - 1);
    }
  }
}

export const videoEditHistoryService = new VideoEditHistoryService();
