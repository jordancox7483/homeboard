'use strict';

// Utility: parse Flickr public feed JSON into normalized photo objects.
// Called from main.js after fetching the raw JSON.

function parseFlickrFeed(data) {
  return (data.items || []).map((item) => {
    const largeUrl = item.media.m.replace('_m.jpg', '_b.jpg');
    const authorMatch = item.author.match(/\("(.+)"\)/);
    const authorName = authorMatch ? authorMatch[1] : item.author;
    return {
      title: item.title,
      url: largeUrl,
      mediumUrl: item.media.m,
      link: item.link,
      author: authorName,
    };
  });
}

module.exports = { parseFlickrFeed };
