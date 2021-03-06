console.log('Loading function');

// dependencies
var AWS = require('aws-sdk');
var crypto = require('crypto');
var config = require('./config.json');

// Get reference to AWS clients
var docClient = new AWS.DynamoDB.DocumentClient();

function computeHash(password, salt, fn) {
    // Bytesize
    var len = 128;
    var iterations = 4096;

    if (3 == arguments.length) {
        crypto.pbkdf2(password, salt, iterations, len, function(err, derivedKey) {
            if (err) return fn(err);
            else fn(null, salt, derivedKey.toString('base64'));
        });
    } else {
        fn = salt;
        crypto.randomBytes(len, function(err, salt) {
            if (err) return fn(err);
            salt = salt.toString('base64');
            computeHash(password, salt, fn);
        });
    }
}

function getUser(email, fn) {
    docClient.get({
        TableName: config.DDB_TABLE,
        Key: {
            email: email
        }
    }, function(err, data) {
        if (err) {
            return fn(err);
        } else {
            if ('Item' in data) {
                var hash = data.Item.passwordHash;
                var salt = data.Item.passwordSalt;
                fn(null, hash, salt);
            } else {
                fn(null, null); // User not found
            }
        }
    });
}

function updateUser(email, password, salt, fn) {
    docClient.update({
        TableName: config.DDB_TABLE,
        Key: {
            email: email
        },
        AttributeUpdates: {
            passwordHash: {
                Action: 'PUT',
                Value: password
            },
            passwordSalt: {
                Action: 'PUT',
                Value: salt
            }
        }
    },
    fn);
}

exports.handler = function(event, context) {
    var email = event.email;
    var oldPassword = event.oldPassword;
    var newPassword = event.newPassword;

    getUser(email, function(err, correctHash, salt) {
        if (err) {
            context.fail('400: Bad Request - Error in getUser: ' + err);
        } else {
            if (correctHash == null) {
                // User not found
                console.log('404: Not Found - User not found: ' + email);
                context.succeed({
                    changed: false
                });
            } else {
                computeHash(oldPassword, salt, function(err, salt, hash) {
                    if (err) {
                        context.fail('400: Bad Request - Error in hash: ' + err);
                    } else {
                        if (hash == correctHash) {
                            // Login ok
                            console.log('User logged in: ' + email);
                            computeHash(newPassword, function(err, newSalt, newHash) {
                                if (err) {
                                    context.fail('400: Bad Request - Error in computeHash: ' + err);
                                } else {
                                    updateUser(email, newHash, newSalt, function(err, data) {
                                        if (err) {
                                            context.fail('422: Unprocessable Entity - Error in updateUser: ' + err);
                                        } else {
                                            console.log('User password changed: ' + email);
                                            context.succeed({
                                                changed: true
                                            });
                                        }
                                    });
                                }
                            });
                        } else {
                            // Login failed
                            context.fail('400: Bad Request - Password not valid, try again!');
                        }
                    }
                });
            }
        }
    });
}
