import { Signal } from "../lib/Signal";

export type SendBusId = string;

/**
 * SendBus – 트랙에서 다른 버스/트랙으로 신호를 보내는 도메인 모델.
 *
 * - `preFader` 가 true 이면 Fader 이전 신호(원본 Games)를 전송합니다.
 * - `preFader` 가 false 이면 Fader 이후 신호를 전송합니다.
 */
export class SendBus {
  public readonly id: SendBusId;
  public readonly sourceTrackId: string;
  public readonly destId: string; // IO id (버스/트랙 input)

  private _level: number; // dB
  private _preFader: boolean;
  private _active: boolean;

  public readonly levelChanged = new Signal<number>();
  public readonly preFaderChanged = new Signal<boolean>();
  public readonly activeChanged = new Signal<boolean>();

  constructor(
    id: SendBusId,
    sourceTrackId: string,
    destId: string,
    level: number = 0,
    preFader: boolean = false,
  ) {
    this.id = id;
    this.sourceTrackId = sourceTrackId;
    this.destId = destId;
    this._level = level;
    this._preFader = preFader;
    this._active = true;
  }

  public get level(): number {
    return this._level;
  }

  public setLevel(db: number): void {
    this._level = db;
    this.levelChanged.emit(db);
  }

  public get preFader(): boolean {
    return this._preFader;
  }

  public setPreFader(value: boolean): void {
    this._preFader = value;
    this.preFaderChanged.emit(value);
  }

  public get active(): boolean {
    return this._active;
  }

  public setActive(value: boolean): void {
    this._active = value;
    this.activeChanged.emit(value);
  }
}
