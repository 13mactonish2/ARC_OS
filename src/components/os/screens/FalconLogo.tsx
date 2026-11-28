// INTEGRATION SHIM (added by agent 3-c): BootScreens.tsx / SetupScreens.tsx import './FalconLogo'
// but the component lives at src/components/os/FalconLogo.tsx. Re-export so the OS compiles.
// Main agent: either keep this shim or change the two imports to '../FalconLogo' and delete this file.
export { FalconLogo } from '../FalconLogo'
