export type DeviceCategory = 'Mobile' | 'Tablet' | 'Desktop';

export interface DevicePreset {
  id: string;
  name: string;
  category: DeviceCategory;
  width: number | '100%';
  height: number | '100%';
}

export interface VisualTweaks {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  bgColor: string;
  textColor: string;
  accentColor: string;
  borderRadius: number;
  borderWidth: number;
  boxShadow: string;
}
