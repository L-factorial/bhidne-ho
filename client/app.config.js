// Firebase's native client configuration is supplied by the build environment.
// Keep signing keys and Firebase service-account credentials on the server.
module.exports = ({config}) => ({
  ...config,
  android: {
    ...config.android,
    ...(process.env.BHIDNE_ANDROID_APPLICATION_ID ? {package:process.env.BHIDNE_ANDROID_APPLICATION_ID} : {}),
    ...(process.env.GOOGLE_SERVICES_JSON ? {googleServicesFile:process.env.GOOGLE_SERVICES_JSON} : {}),
  },
});
