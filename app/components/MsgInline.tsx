import { Image } from 'expo-image';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { mediaUrl } from '../lib/api';
import { getCachedSticker } from '../lib/stickers';

const ID_TOKEN = /^s-[0-9a-f]{32}$/;

/** Renders a message body with custom emoji tokens as real inline images. */
export function InlineBody({ body, style, emojiSize = 17, singleLine = false, prefix = '' }: { body: string; style?: any; emojiSize?: number; singleLine?: boolean; prefix?: string }) {
  const segs = useMemo(() => body.split(/(:[a-zA-Z0-9_-]{2,34}:)/g), [body]);
  return (
    <View style={{ flexDirection: 'row', flexWrap: singleLine ? 'nowrap' : 'wrap', alignItems: 'center', overflow: 'hidden' }}>
      {prefix ? <Text style={style} numberOfLines={1}>{prefix}</Text> : null}
      {segs.map((s, i) => {
        const t = s.match(/^:([a-zA-Z0-9_-]{2,34}):$/);
        if (t) {
          const name = t[1].toLowerCase();
          if (ID_TOKEN.test(name)) {
            return <Image key={i} source={mediaUrl(`${name}.webp`)} style={{ width: emojiSize, height: emojiSize }} contentFit="contain" cachePolicy="memory-disk" />;
          }
          const stk = getCachedSticker(name);
          if (stk?.is_emoji) {
            return <Image key={i} source={stk.url || mediaUrl(stk.id)} style={{ width: emojiSize, height: emojiSize }} contentFit="contain" cachePolicy="memory-disk" />;
          }
          if (stk) return <Text key={i} style={style} numberOfLines={1}>sticker</Text>;
        }
        return <Text key={i} style={style} numberOfLines={singleLine ? 1 : undefined}>{s}</Text>;
      })}
    </View>
  );
}
