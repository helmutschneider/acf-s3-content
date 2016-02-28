/**
 * Created by Johan on 2015-06-19.
 */

/**
 *
 * @param {S3Proxy} proxy
 * @param {Object} config
 * @constructor
 */
function S3FileUploader(proxy, config) {
    this.partSize = 10e6;

    jQuery.extend(this, config || {});

    this.proxy = proxy;
}

/**
 * @param {File}
 * @returns {jQuery.Deferred}
 */
S3FileUploader.prototype.upload = function(key, file) {
    var self = this;

    var partCount = Math.ceil(file.size/this.partSize);
    var completedParts = [];
    var deferred = jQuery.Deferred();

    this.proxy.createMultipartUpload(key, file.type || 'text/plain').then(function(result) {

        var partFunctions = []
        for ( var i = 0; i < partCount; i++ ) {

            // extract a slice of the file
            var part = file.slice(i * self.partSize, (i+1) * self.partSize);

            // create a function to upload the slice
            var func = self.uploadPart.bind(self, part, result.Key, result.UploadId, i + 1);
            partFunctions.push(func);
        }

        var queue = new PromiseQueue(partFunctions);

        // after each upload is done, push the result into the result array
        queue.afterEach = function(data) {
            completedParts.push(data);
        };

        var promise = queue.run();
        var prevTime = Date.now();
        var prevLoaded = 0;
        promise.progress(function(event) {
            var time = Date.now();
            var loaded = completedParts.length * self.partSize + event.loaded;
            deferred.notify({
                loaded: loaded,
                position: loaded/file.size,
                total: file.size,
                speed: (loaded - prevLoaded) / (time - prevTime)
            });
            prevTime = time;
            prevLoaded = loaded;
        });

        // after the queue is complete, complete the multi part upload
        return promise.then(function() {
            return self.proxy.completeMultipartUpload(result.Key, result.UploadId, completedParts)
                .then(deferred.resolve);
        });
    });

    return deferred.promise();
};

/**
 *
 * @param {Blob} part
 * @param {string} key
 * @param {string} uploadId
 * @param {int} partNumber
 * @param {array} completedParts
 * @param {jQuery.Deferred} deferred
 * @returns {jQuery.Deferred}
 */
S3FileUploader.prototype.uploadPart = function(part, key, uploadId, partNumber) {

    var self = this;

    // sign the part with the proxy
    return self.proxy.signUploadPart(key, uploadId, partNumber).then(function(result) {

        var d = jQuery.Deferred();

        // then upload it directly to s3
        jQuery.ajax({
            url: result.Url,
            method: 'put',
            processData: false,
            data: part,
            xhr: function() {
                var xhr = new XMLHttpRequest();
                var fn = function(event) {
                    d.notify(event);
                };
                xhr.addEventListener('progress', fn);
                xhr.upload.addEventListener('progress', fn);
                return xhr;
            }
        }).then(function(result, status, xhr) {

            // the ETag is quoted which can mess up the js/php interaction.
            // remove the quotes.
            var etag = xhr.getResponseHeader('ETag')
            etag = etag.replace(/[^\w]/g, '');

            var data = {
                Key: key,
                PartNumber: partNumber,
                ETag: etag
            };

            d.resolve(data);

            return data;
        });

        return d.promise();
    });
};
