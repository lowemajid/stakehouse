import { useMemo, useReducer, useState } from 'react';
import type { ReactElement } from 'react';
import { StatusBar, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import { createClient } from '@stakehouse/api-client';
import { colors, fontFamilies } from '@stakehouse/theme';
import { INITIAL_ROUTE, reduceRoute } from './lib/route';
import { FONT_MAP } from './lib/fonts';
import { ApiProvider, useApi } from './state/apiContext';
import { SignInScreen } from './screens/SignInScreen';
import { LeagueListScreen } from './screens/LeagueListScreen';
import { CreateLeagueScreen } from './screens/CreateLeagueScreen';
import { LeagueDetailScreen } from './screens/LeagueDetailScreen';

export default function App(): ReactElement {
  // The three house faces load locally — the app renders with zero network
  // beyond its own origin (spec §Design direction).
  const [fontsLoaded] = useFonts(FONT_MAP);

  const [client] = useState(() => createClient());
  const [route, dispatch] = useReducer(reduceRoute, INITIAL_ROUTE);

  const shell = useMemo(
    () => (
      <View
        style={{
          backgroundColor: colors.feltBlack,
          flex: 1,
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <Text style={{ color: colors.cream, fontFamily: fontFamilies.display, fontSize: 32 }}>
          Stakehouse
        </Text>
      </View>
    ),
    [],
  );

  if (!fontsLoaded) return shell;

  return (
    <ApiProvider client={client}>
      <StatusBar barStyle="light-content" />
      <InnerApp dispatch={dispatch} route={route} />
    </ApiProvider>
  );
}

function InnerApp({
  dispatch,
  route,
}: {
  dispatch(action: Parameters<typeof reduceRoute>[1]): void;
  route: ReturnType<typeof reduceRoute>;
}): ReactElement {
  const { user } = useApi();
  if (user === null) return <SignInScreen />;
  switch (route.name) {
    case 'leagues':
      return (
        <LeagueListScreen
          onCreate={() => dispatch({ type: 'openCreateLeague' })}
          onOpen={(leagueId) => dispatch({ type: 'openLeague', leagueId })}
        />
      );
    case 'createLeague':
      return (
        <CreateLeagueScreen
          onBack={() => dispatch({ type: 'back' })}
          onCreated={(league) => dispatch({ type: 'openLeague', leagueId: league.id })}
        />
      );
    case 'leagueDetail':
      return <LeagueDetailScreen leagueId={route.leagueId} />;
  }
}
