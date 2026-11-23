import React, {useLayoutEffect, useRef} from 'react';
import {Audio, Composition, registerRoot, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {renderFrame, WIDTH, HEIGHT, CAPTIONS} from './frame.mjs';

function World({seed, timeline, previewAudio}) {
  const canvas = useRef(null);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  useLayoutEffect(() => {
    const pixels = renderFrame(seconds, {seed, timeline});
    canvas.current.getContext('2d').putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  }, [seconds, seed, timeline]);
  const cue = (timeline?.captions ?? CAPTIONS).find(row => row.start <= seconds && seconds < row.end);
  return <>
    <canvas ref={canvas} width={WIDTH} height={HEIGHT} style={{width:'100%', height:'100%', imageRendering:'pixelated'}} />
    {previewAudio && <Audio src={staticFile('audio.wav')} />}
    {previewAudio && cue && <div style={{position:'absolute', bottom:'7%', alignSelf:'center', background:'#191919', color:'white', padding:'5px 16px', font:'44px Microsoft YaHei, sans-serif'}}>{cue.zh}</div>}
  </>;
}

function Root() {
  return <Composition id="LyricMV" component={World} width={WIDTH} height={HEIGHT} fps={30} durationInFrames={360}
    defaultProps={{fps:30, duration:12, width:WIDTH, height:HEIGHT, previewAudio:false}}
    calculateMetadata={({props}) => ({width:props.width, height:props.height, fps:props.fps, durationInFrames:Math.ceil(props.duration * props.fps - 1e-9)})} />;
}
registerRoot(Root);
