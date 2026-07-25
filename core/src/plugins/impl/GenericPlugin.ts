import {
  Plugin,
  PluginId,
  PluginType,
  PluginParameter,
  ParameterId,
} from "../Plugin";
import { Signal } from "../../lib/Signal";

export class GenericPlugin implements Plugin {
  public readonly id: PluginId;
  public name: string;
  public readonly type: PluginType;

  public readonly parameterChanged = new Signal<{
    id: ParameterId;
    value: number;
  }>();

  private parameters: Map<ParameterId, PluginParameter> = new Map();

  constructor(id: PluginId, name: string, type: PluginType) {
    this.id = id;
    this.name = name;
    this.type = type;
  }

  public addParameter(param: PluginParameter) {
    this.parameters.set(param.id, param);
  }

  public getParameters(): ReadonlyArray<PluginParameter> {
    return Array.from(this.parameters.values());
  }

  public getParameter(id: ParameterId): PluginParameter | undefined {
    return this.parameters.get(id);
  }

  public setParameter(id: ParameterId, value: number): void {
    const param = this.parameters.get(id);
    if (param) {
      param.value = Math.max(param.min, Math.min(param.max, value));
      this.parameterChanged.emit({ id, value: param.value });
    }
  }

  public getState(): Record<string, number> {
    const state: Record<string, number> = {};
    this.parameters.forEach((p, k) => (state[k] = p.value));
    return state;
  }

  public setState(state: Record<string, number>): void {
    for (const key in state) {
      this.setParameter(key, state[key]);
    }
  }
}
