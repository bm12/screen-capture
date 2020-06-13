export const addTracksInStream = (tracks, destinationStream) => {
  tracks.forEach((track) => {
    destinationStream.addTrack(track);
  });
};
