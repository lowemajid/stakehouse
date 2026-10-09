// Expo's preset covers JSX, flow syntax, and the web transforms for RNW.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
