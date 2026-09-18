'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AppStateProvider, useApp } from '@/lib/client/state';
import { PhoneFrame } from './Chrome';
import { DemoDrawer } from './DemoDrawer';
import { ProfileSheet } from './ProfileSheet';
import { DecisionSheet } from './DecisionSheet';
import { PersonaScreen } from './screens/PersonaScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ScannerScreen } from './screens/ScannerScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { CheckoutScreen } from './screens/CheckoutScreen';
import { ApprovedScreen } from './screens/ApprovedScreen';
import { SuccessScreen } from './screens/SuccessScreen';

export function AppShell() {
  return (
    <AppStateProvider>
      <PhoneFrame>
        <Screens />
        <DemoDrawer />
        <ProfileSheet />
        <DecisionSheet />
      </PhoneFrame>
    </AppStateProvider>
  );
}

function Screens() {
  const { screen } = useApp();

  return (
    <div className="relative flex-1 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={screen}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="absolute inset-0"
        >
          {screen === 'persona' ? <PersonaScreen /> : null}
          {screen === 'home' ? <HomeScreen /> : null}
          {screen === 'scanner' ? <ScannerScreen /> : null}
          {screen === 'history' ? <HistoryScreen /> : null}
          {screen === 'checkout' ? <CheckoutScreen /> : null}
          {screen === 'approved' ? <ApprovedScreen /> : null}
          {screen === 'success' ? <SuccessScreen /> : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
