import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

const Noir = definePreset(Aura, {
  semantic: {
    primary: {
      50: 'oklch(0.95 0.2 256)',
      100: 'oklch(0.9 0.2 256)',
      200: 'oklch(0.8 0.2 256)',
      300: 'oklch(0.7 0.2 256)',
      400: 'oklch(0.6 0.2 256)', // #007EFF
      500: 'oklch(0.5 0.2 256)',
      600: 'oklch(0.4 0.2 256)',
      700: 'oklch(0.3 0.2 256)',
      800: 'oklch(0.2 0.2 256)',
      900: 'oklch(0.1 0.2 256)',
      950: 'oklch(0.05 0.2 256)',
    },
  },
});

export default Noir;
