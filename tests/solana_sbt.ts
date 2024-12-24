import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaSbt } from "../target/types/solana_sbt";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { createAssociatedTokenAccountInstruction, createTransferInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import {
	findMasterEditionPda,
	findMetadataPda,
	mplTokenMetadata,
	MPL_TOKEN_METADATA_PROGRAM_ID,
} from "@metaplex-foundation/mpl-token-metadata";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";

import {
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import { clusterApiUrl, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("solana-sbt", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaSbt as Program<SolanaSbt>;
  
  // Treasury wallet from your program
  const TREASURY_WALLET = new PublicKey("9msUhPoGYz2Wp2c1uhPVvsTQBYhqctVTRmZMNwZerKzk");

  let collectionMint: PublicKey;
  let collectionMetadata: PublicKey;
  let collectionMasterEdition: PublicKey;
  let configPDA: PublicKey;

  const TOKEN_METADATA_PROGRAM_ID = new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID);

  before(async () => {
    // Airdrop SOL to payer
    const signature = await provider.connection.requestAirdrop(
      provider.wallet.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);
  });

  it("Initializes collection", async () => {
    // Generate collection mint
    [collectionMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("collection")],
      program.programId
    );

    // Find PDA for collection config
    [configPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("collection_config")],
      program.programId
    );

    // Get PDA addresses for metadata accounts
    const [metadataAddress] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionMint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    collectionMetadata = metadataAddress;

    const [masterEditionAddress] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionMint.toBuffer(),
        Buffer.from("edition"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    collectionMasterEdition = masterEditionAddress;

    // Get associated token account for collection
    const collectionTokenAccount = await anchor.utils.token.associatedAddress({
      mint: collectionMint,
      owner: provider.wallet.publicKey,
    });

    try {
      await program.methods
        .initializeCollection(
            "NAME",
            "SYMBOL",
            "https://arweave.net/h19GMcMz7RLDY7kAHGWeWolHTmO83mLLMNPzEkF32BQ",
        )
        .accounts({
          // authority: provider.wallet.publicKey,
          // collectionMint,
          // collectionTokenAccount: collectionTokenAccount,
          collectionMetadata: collectionMetadata,
          collectionMasterEdition: collectionMasterEdition,
          // config: configPDA,
          // metadataProgram: TOKEN_METADATA_PROGRAM_ID,
          // tokenProgram: TOKEN_PROGRAM_ID,
          // associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          // systemProgram: SystemProgram.programId,
          // rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        // .signers([collectionMint])
        .rpc();

      // Verify config account
      const configAccount = await program.account.collectionConfig.fetch(configPDA);
      assert.equal(configAccount.currentId.toString(), "0");
      assert.equal(configAccount.priceLevel1.toString(), "0");
      assert.equal(configAccount.priceLevel2.toString(), "200000000");
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  });

  it("Gets current price", async () => {
    const price = await program.methods
      .getCurrentPrice()
      .accounts({
        config: configPDA,
      })
      .view();

    assert.equal(price.toString(), "0"); // Should be price_level1 initially
  });

  it("Mints NFT", async () => {
    const mint = Keypair.generate();
    const metadataAddress = (PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.publicKey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    ))[0];

    const masterEditionAddress = (PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.publicKey.toBuffer(),
        Buffer.from("edition"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    ))[0];

    const associatedTokenAccount = await anchor.utils.token.associatedAddress({
      mint: mint.publicKey,
      owner: provider.wallet.publicKey,
    });

    const initialTreasuryBalance = await provider.connection.getBalance(TREASURY_WALLET);

    await program.methods
      .mintNft("Test NFT", "TEST", "https://arweave.net/nft-uri")
      .accounts({
        // payer: provider.wallet.publicKey,
        mint: mint.publicKey,
        // associatedTokenAccount: associatedTokenAccount,
        metadataAccount: metadataAddress,
        masterEditionAccount: masterEditionAddress,
        // collectionMint: collectionMint.publicKey,
        collectionMetadata: collectionMetadata,
        collectionMasterEdition: collectionMasterEdition
        // config: configPDA,
        // treasury: TREASURY_WALLET,
        // tokenProgram: TOKEN_PROGRAM_ID,
        // associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        // metadataProgram: METADATA_PROGRAM_ID,
        // systemProgram: SystemProgram.programId,
        // rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mint])
      .rpc();

    // Verify token mint
    const tokenBalance = await provider.connection.getTokenAccountBalance(
      associatedTokenAccount
    );
    assert.equal(tokenBalance.value.uiAmount, 1);

    // Verify counter increment
    const configAccount = await program.account.collectionConfig.fetch(configPDA);
    assert.equal(configAccount.currentId.toString(), "1");

    // Verify treasury payment (should be 0 for first tier)
    // const finalTreasuryBalance = await provider.connection.getBalance(TREASURY_WALLET);

    // assert.equal(finalTreasuryBalance - initialTreasuryBalance, 0);

    // let originalTokenAccount = associatedTokenAccount
    // const recipient = Keypair.generate();
    // // Recipient's ATA
    // const recipientTokenAccount = await anchor.utils.token.associatedAddress({
    //     mint: mint.publicKey,
    //     owner: recipient.publicKey,
    // });
    // // Try to transfer the NFT
    // try {
    //   // Create recipient's token account
    //   const createAtaIx = createAssociatedTokenAccountInstruction(
    //       provider.wallet.publicKey, // payer
    //       recipientTokenAccount, // ata
    //       recipient.publicKey, // owner
    //       mint.publicKey // mint
    //   );

    //   // Create transfer instruction
    //   const transferIx = createTransferInstruction(
    //       originalTokenAccount, // source
    //       recipientTokenAccount, // destination
    //       provider.wallet.publicKey, // owner
    //       1 // amount
    //   );

    //   // Combine instructions
    //   const transaction = new anchor.web3.Transaction()
    //       .add(createAtaIx)
    //       .add(transferIx);
      
    //   await provider.sendAndConfirm(transaction);
      
    //   assert.fail("Transfer should have failed - SBT should not be transferable");
    // } catch (error) {
    //   console.log('error', error.message)
    //   // Verify it's the expected error
    //   assert.include(
    //       error.message,
    //       "SBT should not be transferable",
    //       "Should fail with transfer error"
    //   );

    //   // Verify the token is still in the original account
    //   const originalBalance = await provider.connection.getTokenAccountBalance(
    //       originalTokenAccount
    //   );
    //   console.log('originalBalance', originalBalance)
    //   assert.equal(originalBalance.value.uiAmount, 1, "Original owner should still have the token");

    //   // Verify recipient didn't receive the token
    //   try {
    //       const recipientBalance = await provider.connection.getTokenAccountBalance(
    //           recipientTokenAccount
    //       );
    //       assert.equal(recipientBalance.value.uiAmount, 0, "Recipient should not have received the token");
    //   } catch (e) {
    //       // It's also acceptable if the recipient's token account doesn't exist
    //       console.log("Recipient token account not created, which is expected");
    //   }
    // }
  });

  it("Updates prices", async () => {
    await program.methods
      .updatePrices(
        new anchor.BN(100000000), // 0.1 SOL
        new anchor.BN(200000000), // 0.2 SOL
        new anchor.BN(300000000), // 0.3 SOL
        new anchor.BN(400000000), // 0.4 SOL
        new anchor.BN(500000000)  // 0.5 SOL
      )
      .accounts({
        authority: provider.wallet.publicKey,
        // config: configPDA,
      })
      .rpc();

    const configAccount = await program.account.collectionConfig.fetch(configPDA);
    assert.equal(configAccount.priceLevel1.toString(), "100000000");
  });

  // it("Should fail to transfer SBT", async () => {
  //   // Create a new recipient wallet
  //   const recipient = Keypair.generate();
    
  //   // First mint an NFT
  //   const mint = Keypair.generate();
  //   // Get PDA addresses for metadata accounts
  //   const [metadataAddress] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from("metadata"),
  //       TOKEN_METADATA_PROGRAM_ID.toBuffer(),
  //       collectionMint.publicKey.toBuffer(),
  //     ],
  //     TOKEN_METADATA_PROGRAM_ID
  //   );
  //   collectionMetadata = metadataAddress;

  //   const [masterEditionAddress] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from("metadata"),
  //       TOKEN_METADATA_PROGRAM_ID.toBuffer(),
  //       collectionMint.publicKey.toBuffer(),
  //       Buffer.from("edition"),
  //     ],
  //     TOKEN_METADATA_PROGRAM_ID
  //   );

  //       // Original owner's ATA
  //       const originalTokenAccount = await anchor.utils.token.associatedAddress({
  //           mint: mint.publicKey,
  //           owner: provider.wallet.publicKey,
  //       });

  //       // Recipient's ATA
  //       const recipientTokenAccount = await anchor.utils.token.associatedAddress({
  //           mint: mint.publicKey,
  //           owner: recipient.publicKey,
  //       });

  //       // First mint the NFT
  //       try {
  //           await program.methods
  //               .mintNft("Test NFT", "TEST", "https://arweave.net/nft-uri")
  //               .accounts({
  //                   payer: provider.wallet.publicKey,
  //                   mint: mint.publicKey,
  //                   // associatedTokenAccount: originalTokenAccount,
  //                   metadataAccount: metadataAddress,
  //                   masterEditionAccount: masterEditionAddress,
  //                   collectionMint: collectionMint.publicKey,
  //                   collectionMetadata: collectionMetadata,
  //                   // config: configPDA,
  //                   // treasury: TREASURY_WALLET,
  //                   // tokenProgram: TOKEN_PROGRAM_ID,
  //                   // associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //                   // metadataProgram: TOKEN_METADATA_PROGRAM_ID,
  //                   // systemProgram: SystemProgram.programId,
  //                   // rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  //               })
  //               .signers([mint])
  //               .rpc();

  //           // Airdrop some SOL to recipient for account creation
  //           const signature = await provider.connection.requestAirdrop(
  //               recipient.publicKey,
  //               LAMPORTS_PER_SOL
  //           );
  //           await provider.connection.confirmTransaction(signature);

  //           // Try to transfer the NFT
  //           try {
  //             // Create recipient's token account
  //             const createAtaIx = createAssociatedTokenAccountInstruction(
  //                 provider.wallet.publicKey, // payer
  //                 recipientTokenAccount, // ata
  //                 recipient.publicKey, // owner
  //                 mint.publicKey // mint
  //             );

  //             // Create transfer instruction
  //             const transferIx = createTransferInstruction(
  //                 originalTokenAccount, // source
  //                 recipientTokenAccount, // destination
  //                 provider.wallet.publicKey, // owner
  //                 1 // amount
  //             );

  //             // Combine instructions
  //             const transaction = new anchor.web3.Transaction()
  //                 .add(createAtaIx)
  //                 .add(transferIx);
              
  //             await provider.sendAndConfirm(transaction);
              
  //             assert.fail("Transfer should have failed - SBT should not be transferable");
  //           } catch (error) {
  //             // Verify it's the expected error
  //             assert.include(
  //                 error.message,
  //                 "failed to send transaction",
  //                 "Should fail with transfer error"
  //             );

  //             // Verify the token is still in the original account
  //             const originalBalance = await provider.connection.getTokenAccountBalance(
  //                 originalTokenAccount
  //             );
  //             assert.equal(originalBalance.value.uiAmount, 1, "Original owner should still have the token");

  //             // Verify recipient didn't receive the token
  //             try {
  //                 const recipientBalance = await provider.connection.getTokenAccountBalance(
  //                     recipientTokenAccount
  //                 );
  //                 assert.equal(recipientBalance.value.uiAmount, 0, "Recipient should not have received the token");
  //             } catch (e) {
  //                 // It's also acceptable if the recipient's token account doesn't exist
  //                 console.log("Recipient token account not created, which is expected");
  //             }
  //           }

  //           // // Additional verification: Check Uses count
  //           // const metadata = await program.provider.connection.getAccountInfo(metadataAddress);
  //           // // Note: You'll need to properly decode the metadata account to verify the uses count
  //           // // This is a simplified check, you might want to add more detailed verification
  //           // assert.ok(metadata, "Metadata account should exist");

  //       } catch (error) {
  //           console.error("Test error:", error);
  //           throw error;
  //       }
  //   });

  // it("Fails to mint with insufficient funds", async () => {
  //   const mint = Keypair.generate();
  //   const poorWallet = Keypair.generate(); // Wallet with no SOL

  //   const metadataAddress = (PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from("metadata"),
  //       TOKEN_METADATA_PROGRAM_ID.toBuffer(),
  //       mint.publicKey.toBuffer(),
  //     ],
  //     TOKEN_METADATA_PROGRAM_ID
  //   ))[0];

  //   const masterEditionAddress = (PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from("metadata"),
  //       TOKEN_METADATA_PROGRAM_ID.toBuffer(),
  //       mint.publicKey.toBuffer(),
  //       Buffer.from("edition"),
  //     ],
  //     TOKEN_METADATA_PROGRAM_ID
  //   ))[0];

  //   const associatedTokenAccount = await anchor.utils.token.associatedAddress({
  //     mint: mint.publicKey,
  //     owner: poorWallet.publicKey,
  //   });

  //   try {
  //     await program.methods
  //       .mintNft("Test NFT", "TEST", "https://arweave.net/nft-uri")
  //       .accounts({
  //         payer: poorWallet.publicKey,
  //         mint: mint.publicKey,
  //         // associatedTokenAccount: associatedTokenAccount,
  //         metadataAccount: metadataAddress,
  //         masterEditionAccount: masterEditionAddress,
  //         collectionMint: collectionMint.publicKey,
  //         collectionMetadata: collectionMetadata,
  //         // config: configPDA,
  //         // treasury: TREASURY_WALLET,
  //         // tokenProgram: TOKEN_PROGRAM_ID,
  //         // associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //         // metadataProgram: METADATA_PROGRAM_ID,
  //         // systemProgram: SystemProgram.programId,
  //         // rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  //       })
  //       .signers([mint, poorWallet])
  //       .rpc();
      
  //     assert.fail("Should have failed with insufficient funds");
  //   } catch (error) {
  //     assert.include(error.message, "Insufficient funds");
  //   }
  // });
});

// describe("solana-nft-anchor", async () => {
// 	// Configured the client to use the devnet cluster.
// 	const provider = anchor.AnchorProvider.env();
// 	anchor.setProvider(provider);
// 	const program = anchor.workspace
// 		.XstarSolanaSbt as Program<XstarSolanaSbt>;

// 	const signer = provider.wallet;

//     // Treasury wallet from your program
//     const TREASURY_WALLET = new PublicKey("9msUhPoGYz2Wp2c1uhPVvsTQBYhqctVTRmZMNwZerKzk");

// 	const umi = createUmi("https://api.devnet.solana.com")
// 		.use(walletAdapterIdentity(signer))
// 		.use(mplTokenMetadata());

// 	const mint = anchor.web3.Keypair.generate();

// 	// Derive the associated token address account for the mint
// 	const associatedTokenAccount = await getAssociatedTokenAddress(
// 		mint.publicKey,
// 		signer.publicKey
// 	);

// 	// derive the metadata account
// 	let metadataAccount = findMetadataPda(umi, {
// 		mint: publicKey(mint.publicKey),
// 	})[0];

// 	//derive the master edition pda
// 	let masterEditionAccount = findMasterEditionPda(umi, {
// 		mint: publicKey(mint.publicKey),
// 	})[0];

// 	const metadata = {
// 		name: "Kobeni",
// 		symbol: "kBN",
// 		uri: "https://raw.githubusercontent.com/687c/solana-nft-native-client/main/metadata.json",
// 	};

// 	it("mints nft!", async () => {
// 		const tx = await program.methods
// 			.mintNft(metadata.name, metadata.symbol, metadata.uri)
// 			.accounts({
// 				// signer: provider.publicKey,
// 				mint: mint.publicKey,
// 				// associatedTokenAccount,
        
// 				metadataAccount,
// 				masterEditionAccount,
// 				// tokenProgram: TOKEN_PROGRAM_ID,
// 				// associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
// 				// tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
// 				// systemProgram: anchor.web3.SystemProgram.programId,
// 				// rent: anchor.web3.SYSVAR_RENT_PUBKEY,
// 			})
// 			.signers([mint])
// 			.rpc();

// 		console.log(
// 			`mint nft tx: https://explorer.solana.com/tx/${tx}?cluster=devnet`
// 		);
// 		console.log(
// 			`minted nft: https://explorer.solana.com/address/${mint.publicKey}?cluster=devnet`
// 		);
// 	});
// });

