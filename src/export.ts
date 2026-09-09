import { fileSave } from 'browser-fs-access';

export const exportToSvgFile = async (svg: SVGSVGElement) => {
  const savedMs = svg.getCurrentTime();
  svg.setCurrentTime(0);
  const svgStr = new XMLSerializer().serializeToString(svg);
  svg.setCurrentTime(savedMs);
  await fileSave(new Blob([svgStr], { type: 'image/svg+xml' }), {
    fileName: 'excalidraw-animate.svg',
    extensions: ['.svg'],
  });
};

export const exportToWebmFile = async (data: Blob) => {
  await fileSave(new Blob([data], { type: 'video/webm' }), {
    fileName: 'excalidraw-animate.webm',
    extensions: ['.webm'],
  });
};

export const prepareWebmData = (
  svgList: {
    svg: SVGSVGElement;
    finishedMs: number;
  }[],
) =>
  new Promise<Blob>((resolve, reject) => {
    navigator.mediaDevices
      .getDisplayMedia({
        video: {
          // @ts-expect-error browser-specific constraints
          cursor: 'never',
          displaySurface: 'browser',
          frameRate: {
            ideal: 30,
            max: 30,
          },
        },
        audio: false,
      })
      .then(async (stream) => {
        const track = stream.getVideoTracks()[0];

        await track.applyConstraints({
          frameRate: {
            ideal: 30,
            max: 30,
          },
        });

        const mimeType = [
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm',
        ].find((type) => MediaRecorder.isTypeSupported(type));
        const recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: 25_000_000,
        });
        recorder.ondataavailable = (e) => {
          resolve(e.data);
        };
        let maxFinishedMs = 0;
        svgList.forEach(({ svg, finishedMs }) => {
          maxFinishedMs = Math.max(maxFinishedMs, finishedMs);
          svg.pauseAnimations();
          svg.setCurrentTime(0);
        });
        recorder.start();
        svgList.forEach(({ svg }) => {
          svg.unpauseAnimations();
        });
        setTimeout(() => {
          recorder.stop();
          track.stop();
        }, maxFinishedMs);
      })
      .catch(reject);
  });
