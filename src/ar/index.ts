import './ar.css';
import { ArView } from './arView';
import type { ArHostApi, ArWorkstream } from './host';

export type { ArHostApi, ArWorkstream } from './host';
export { ArView } from './arView';
export {
  CALIBRATION_STORAGE_KEY,
  DEFAULT_HORIZONTAL_FOV_DEG,
  estimatePointingError,
  loadCalibration,
  saveCalibration,
  type CalibrationState,
} from './calibration';
export { computeDeclination, type DeclinationResult } from './declination';
export {
  cameraForward,
  headingFromQuat,
  pitchFromQuat,
  quatFromDeviceOrientation,
  quatFromVirtualLook,
  type Quat,
} from './math';

/**
 * Create an AR workstream. The module owns the DOM inside `root`; call
 * `mount()` when the AR tab becomes visible and `unmount()` when it is torn
 * down. `update()` is idempotent: the module also subscribes through the host.
 */
export function createArWorkstream(root: HTMLElement, api: ArHostApi): ArWorkstream {
  return new ArView(root, api);
}

export default createArWorkstream;
