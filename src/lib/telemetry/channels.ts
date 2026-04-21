import { ChannelDef } from "./types";

// Map raw CSV columns -> nice display metadata.
// Anything not listed will still be loaded with sensible defaults.

type Meta = Omit<ChannelDef, "source" | "file"> & { source: string };

const GNS_META: Meta[] = [
  { key: "state", source: "gStateMachine.status.state", label: "State", unit: "", group: "Vehicle" },
  { key: "steerAngle", source: "gSteeringAngle.data.angleDegrees", label: "Steering Angle", unit: "°", group: "Steering" },
  { key: "brakeRear", source: "gBraking.data.pressurePercentageRear", label: "Brake Rear", unit: "%", group: "Brakes" },
  { key: "brakeFront", source: "gBraking.data.pressurePercentageFront", label: "Brake Front", unit: "%", group: "Brakes" },
  { key: "throttle", source: "gTorqueSensor.status.torquePercentage", label: "Throttle", unit: "%", group: "Throttle" },
  { key: "speed", source: "gInverters.data.averageVelocityKmh", label: "Speed", unit: "km/h", group: "Vehicle" },

  { key: "trqLimFL", source: "gInverters.inverter[0].outputs.com_torqueLimitPos", label: "Trq Limit FL", unit: "Nm", group: "Inverters" },
  { key: "trqLimFR", source: "gInverters.inverter[1].outputs.com_torqueLimitPos", label: "Trq Limit FR", unit: "Nm", group: "Inverters" },
  { key: "trqLimRL", source: "gInverters.inverter[2].outputs.com_torqueLimitPos", label: "Trq Limit RL", unit: "Nm", group: "Inverters" },
  { key: "trqLimRR", source: "gInverters.inverter[3].outputs.com_torqueLimitPos", label: "Trq Limit RR", unit: "Nm", group: "Inverters" },

  { key: "iqFL", source: "gInverters.inverter[0].data.torqueCurrent", label: "Iq FL", unit: "A", group: "Inverters" },
  { key: "iqFR", source: "gInverters.inverter[1].data.torqueCurrent", label: "Iq FR", unit: "A", group: "Inverters" },
  { key: "iqRL", source: "gInverters.inverter[2].data.torqueCurrent", label: "Iq RL", unit: "A", group: "Inverters" },
  { key: "iqRR", source: "gInverters.inverter[3].data.torqueCurrent", label: "Iq RR", unit: "A", group: "Inverters" },

  { key: "motorMaxT", source: "gmotorMaxTemp", label: "Motor Max Temp", unit: "°C", group: "Temps" },
  { key: "invMaxT", source: "ginverterMaxTemp", label: "Inverter Max Temp", unit: "°C", group: "Temps" },
  { key: "cellMaxT", source: "gAMS.data.cellTempMax", label: "Cell Max Temp", unit: "°C", group: "Temps" },

  { key: "packV", source: "gORION.data.packVoltage", label: "Pack Voltage", unit: "V", group: "Battery" },
  { key: "packI", source: "gORION.data.outputCurrent", label: "Pack Current", unit: "A", group: "Battery" },
];

const INS_META: Meta[] = [
  { key: "accX", source: "gINS.input.accX", label: "Accel X", unit: "m/s²", group: "IMU" },
  { key: "accY", source: "gINS.input.accY", label: "Accel Y", unit: "m/s²", group: "IMU" },
  { key: "accZ", source: "gINS.input.accZ", label: "Accel Z", unit: "m/s²", group: "IMU" },
  { key: "gyroX", source: "gINS.input.gyroX", label: "Gyro X", unit: "rad/s", group: "IMU" },
  { key: "gyroY", source: "gINS.input.gyroY", label: "Gyro Y", unit: "rad/s", group: "IMU" },
  { key: "gyroZ", source: "gINS.input.gyroZ", label: "Gyro Z", unit: "rad/s", group: "IMU" },
  { key: "velX", source: "gINS.input.velX", label: "Velocity X", unit: "m/s", group: "INS" },
  { key: "velY", source: "gINS.input.velY", label: "Velocity Y", unit: "m/s", group: "INS" },

  { key: "gnssLon", source: "gINS.input.gnssPosLon", label: "GNSS Lon", unit: "°", group: "GPS" },
  { key: "gnssLat", source: "gINS.input.gnssPosLat", label: "GNSS Lat", unit: "°", group: "GPS" },
  { key: "gnssUncE", source: "gINS.input.gnssUncertaintyE", label: "GNSS Unc. E", unit: "m", group: "GPS" },
  { key: "gnssUncN", source: "gINS.input.gnssUncertaintyN", label: "GNSS Unc. N", unit: "m", group: "GPS" },
  { key: "insAlt", source: "gINS.input.insPosAlt", label: "INS Altitude", unit: "m", group: "INS" },
  { key: "insLon", source: "gINS.input.insPosLon", label: "INS Lon", unit: "°", group: "INS" },
  { key: "insLat", source: "gINS.input.insPosLat", label: "INS Lat", unit: "°", group: "INS" },
  { key: "insUnc", source: "gINS.input.insPosUncertainty", label: "INS Uncertainty", unit: "m", group: "INS" },
  { key: "gnssFix", source: "gINS.input.gnssFix", label: "GNSS Fix", unit: "", group: "GPS" },
];

export function buildChannelDefs(file: "GNS" | "INS", sourceColumns: string[]): ChannelDef[] {
  const meta = file === "GNS" ? GNS_META : INS_META;
  const usedSources = new Set<string>();
  const defs: ChannelDef[] = [];

  for (const m of meta) {
    if (sourceColumns.includes(m.source)) {
      defs.push({ ...m, file });
      usedSources.add(m.source);
    }
  }
  // Anything else from CSV that wasn't mapped — include with raw name.
  for (const col of sourceColumns) {
    if (col === "Timestamp" || usedSources.has(col)) continue;
    defs.push({
      key: `${file.toLowerCase()}_${col}`,
      source: col,
      label: col,
      unit: "",
      group: file === "GNS" ? "Vehicle" : "INS",
      file,
    });
  }
  return defs;
}
