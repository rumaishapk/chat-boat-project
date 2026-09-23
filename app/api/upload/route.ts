// Polyfill missing browser globals for PDF.js in Node environment
if (typeof (global as any).DOMMatrix === 'undefined') {
  (global as any).DOMMatrix = class DOMMatrix {};
}
if (typeof (global as any).ImageData === 'undefined') {
  (global as any).ImageData = class ImageData {};
}
if (typeof (global as any).Path2D === 'undefined') {
  (global as any).Path2D = class Path2D {};
}

import { NextRequest, NextResponse } from "next/server";
import ImageKit from "imagekit";
import { chunkText } from "@/lib/chunkText";
import { createEmbedding } from "@/lib/embeddings";
import { pineconeIndex } from "@/lib/pinecone";

const imagekit = new ImageKit({
  publicKey: process.env.NEXT_PUBLIC_PUBLIC_KEY || process.env.IMAGEKIT_PUBLIC_KEY || "",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || process.env.PRIVATE_KEY || "",
  urlEndpoint: process.env.NEXT_PUBLIC_URL_ENDPOINT || process.env.IMAGEKIT_URL_ENDPOINT || "",
});

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 1. Upload to ImageKit
    const uploadResponse = await imagekit.upload({
      file: buffer,
      fileName: file.name,
      folder: "/rumigpt-documents",
    });

    console.log("Uploaded successfully to ImageKit:", uploadResponse.url);

    const documentId = uploadResponse.fileId;

    // 2. Extract Text from PDF
    // 2. Extract Text from PDF
    // 2. Extract Text from PDF using pdf2json (Pure JS, no native canvas needed)
    let extractedText = "";
    try {
      const PDFParser = require("pdf2json");
      const pdfParser = new PDFParser(null, 1);

      extractedText = await new Promise<string>((resolve, reject) => {
        pdfParser.on("pdfParser_dataError", (errData: any) => reject(errData.parserError));
        pdfParser.on("pdfParser_dataReady", () => {
          const rawText = pdfParser.getRawTextContent();
          resolve(rawText || "");
        });
        pdfParser.parseBuffer(buffer);
      });

      console.log(`Extracted ${extractedText.trim().length} characters from PDF.`);
    } catch (parseErr: any) {
      console.error("PDF parse error:", parseErr);
    }

    // 3. Chunk text, create embeddings and upsert to Pinecone
    if (extractedText.trim().length > 0) {
      const chunks = chunkText(extractedText);
      console.log(`Generated ${chunks.length} chunks for documentId: ${documentId}`);

      const vectors = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await createEmbedding(chunk);

        if (embedding && embedding.length > 0) {
          vectors.push({
            id: `${documentId}_chunk_${i}`,
            values: embedding,
            metadata: {
              documentId: documentId,
              text: chunk,
              chunkIndex: i,
            },
          });
        }
      }

      if (vectors.length > 0) {
        // Upsert in batches of 50 to Pinecone
        const batchSize = 50;
        for (let i = 0; i < vectors.length; i += batchSize) {
          const batch = vectors.slice(i, i + batchSize);
          await pineconeIndex.upsert({ records: batch });
        }
        console.log(`Successfully upserted ${vectors.length} vectors to Pinecone.`);
      }
    } else {
      console.warn("Warning: No text could be extracted from this PDF.");
    }

    return NextResponse.json({
      success: true,
      fileUrl: uploadResponse.url,
      documentId: documentId,
    });
  } catch (error: any) {
    console.error("ImageKit / Upload error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process upload" },
      { status: 500 }
    );
  }
}