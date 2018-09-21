'use strict';

const aws = require('aws-sdk');
const s3 = new aws.S3();
const async = require('async');
const request = require('request');
const url = require('url');
const path = require('path');

let bucketName = '';
let userName = '';
let endpoint = '';
const postFilePrefix = '.testfile.json';

/*
 * Feedを取得する 
 */
let getInstagramFeed = (callback) => {
    console.log('1. getInstagramFeed start.');
    let options = {
        method: 'GET',
        uri: endpoint
    };
    request(options, function (error, response, body) {
        console.log('1. getInstagramFeed end.', response.statusCode);
        callback(null, body);
    });     
};


/*
 * Feedをパースする
 */
let parseInstagramFeed = (body, callback) => {
    console.log('2. parseInstagramFeed start.');

    let datas = JSON.parse(body).data.reverse();
    async.eachSeries(datas, function(data, next) {
        async.waterfall([
            (callback) => {
                // サムネイルのダウンロード
                downloadThumbnail(data, callback);  
            },
            (data, callback) => {
                // メディアのダウンロード                
                downloadMedia(data, callback);
            },
            (data, mediaFiles, callback) => {
                // postfileの生成
                createPostfile(data, mediaFiles, callback);
            }            
        ], (err) => {
            if (err) throw err;
            next();
        });           
    }, function(err) {
        if (err) throw err;
        console.log('2. parseInstagramFeed end.');
        callback(null);
    });
};


/*
 * サムネイルのダウンロード
 */
let downloadThumbnail = (data, callback) => {
    let thumbUrl = data.images.standard_resolution.url;
    console.log(`3. downloadThumbnail start. ${thumbUrl}`);
    async.waterfall([
        (callback) => {
            getMediaFile(thumbUrl, callback);          
        },
        (fileName, binary, callback) => {
            saveMediaFile(fileName, binary, callback);
        }          
    ], (err, fileName) => {
        if (err) console.error(err, err.stack);
        console.log(`3. downloadThumbnail end. ${fileName}`);
        callback(null, data);
    });   
}


/*
 * メディアのダウンロード
 */
let downloadMedia = (data, callback) => {
    console.log(`4. downloadMedia start. [${data.type}]`);
    let mediaFiles = [];
    switch (data.type) {
        case 'image':
        case 'video':
            async.waterfall([
                (callback) => {
                    getMediaFile(getMediaUrl(data), callback);
                },
                (fileName, binary, callback) => {
                    saveMediaFile(fileName, binary, callback);
                }          
            ], (err, fileName) => {
                if (err) console.error(err, err.stack);
                mediaFiles.push(fileName);
                console.log(`4. downloadMedia end. ${mediaFiles}`);
                callback(null, data, mediaFiles);
            });   
            break; 
        case 'carousel':
            async.eachSeries(data.carousel_media, function(media, next) {
                async.waterfall([
                    (callback) => {
                        getMediaFile(getMediaUrl(media), callback);          
                    },
                    (fileName, binary, callback) => {
                        saveMediaFile(fileName, binary, callback);
                    }          
                ], (err, fileName) => {
                    if (err) console.error(err, err.stack);
                    mediaFiles.push(fileName);
                    next();
                });
            }, function(err) {
                if (err) throw err;
                console.log(`4. downloadMedia end. ${mediaFiles}`);
                callback(null, data, mediaFiles);
            });            
            break;    
        default:
            console.log('undefined post type.');
    }
} 


/*
 * メディアURLを取得する
 */
let getMediaUrl = (media) => {
    let mediaUrl = '';
    if (media.type === 'image') mediaUrl = media.images.standard_resolution.url;
    if (media.type === 'video') mediaUrl = media.videos.standard_resolution.url;
    return mediaUrl;
}


/*
 * postfileの生成
 */
let createPostfile = (data, mediaFiles, callback) => {
    console.log(`5. createPostfile start.`);
    let parsed = url.parse(data.images.standard_resolution.url);
    let eyecatchFile = path.basename(parsed.pathname);
    let caption = '';
    if (data.caption != undefined) {
        caption = data.caption.text;
    }
    
    let postData = {
        "userName": userName,
        "eyecatchFile": eyecatchFile,  
        "mediaFiles": mediaFiles,
        "created_time": data.created_time,
        "captionText": caption,
        "tags": data.tags
    }
    console.log(postData);

    let key = `${userName}/${eyecatchFile}${postFilePrefix}`;
    s3.getObject({Bucket: bucketName, Key: key}, function(err, data) {
        if (err) {
            console.log('   post file not found, saving.');
            s3.putObject({ Bucket: bucketName, Key: key, Body: JSON.stringify(postData) }, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                } else {
                    console.log(`   post file saved. ${key}`);
                    console.log(`5. createPostfile end.`);
                    callback(null);
                }                               
            });            
        } else {
            console.log('   post file already exists, skipped.');
            console.log(`5. createPostfile end.`);
            callback(null);
        }
    });
} 


/*
 * メディアを取得する 
 */
let getMediaFile = (mediaUrl, callback) => {
    console.log(`   getMediaFile start. ${mediaUrl}`);
    let options = {
        method: 'GET',
        uri: mediaUrl,
        encoding: null
    };
    request(options, function (error, response, body) {
        console.log('   getMediaFile end.', response.statusCode);
        let parsed = url.parse(mediaUrl);
        let fileName = path.basename(parsed.pathname);
        callback(null, fileName, new Buffer(body, 'binary'));
    });    
};


/*
 * 画像をS3に保存する 
 */
let saveMediaFile = (fileName, binary, callback) => {
    console.log(`   saveMediaFile start. ${bucketName}/${userName}/${fileName}`);
    s3.getObject({Bucket: bucketName, Key: `${userName}/${fileName}`}, function(err, data) {
        if (err) {
            console.log('   file not found.');
            s3.putObject({ Bucket: bucketName, Key: `${userName}/${fileName}`, Body: binary }, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                } else {
                    console.log('   saveMediaFile end. save media done.');
                }                               
            });            
        } else {
            console.log('   saveMediaFile end. file already exists, skipped.');
        }
        callback(null, fileName);
    });    
};


/*
 * メイン処理
 */
exports.handler = (event, context, callback) => {
    console.log('event:\n', event);
    bucketName = event.bucketname || `${process.env.BUCKET_NAME}`;
    userName = event.username;
    endpoint = event.endpoint;

    async.waterfall([
        (callback) => {
            getInstagramFeed(callback);          
        },
        (body, callback) => {
            parseInstagramFeed(body, callback);
        }
    ], (err) => {
        if (err) console.error(err, err.stack);
        console.log('all done.');
        callback(null, 'success');
    });
    
};
