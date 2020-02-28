import fs from 'fs-extra';
import path from 'path';
import UploadClient from '@uploadcare/upload-client';

const client = new UploadClient();

export const uploadPdf = (filepath: string): Promise<string> => upload(filepath, 'application/pdf');

export const uploadTxt = (filepath: string): Promise<string> => upload(filepath, 'text/plain');

export const readFileToBuffer = (filepath: string): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const chunks: any = [];
        const fileStream = fs.createReadStream(filepath);

        fileStream.on('data', (chunk) => {
            chunks.push(chunk);
        });

        fileStream.once('error', (error) => {
            reject(error);
        });

        fileStream.once('end', () => {
            resolve(Buffer.concat(chunks));
        });
    });
